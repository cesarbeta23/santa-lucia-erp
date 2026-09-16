import { useState, useRef } from 'react'
import { C, Btn, Inp, Sel, Txt, Modal, Badge, Empty, card, fmt, fmtDate, Progress } from '../components/UI.jsx'
import { callClaude } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'

const ESTADOS_ACTA = {
  pendiente:  { label: 'Pendiente',  color: 'amber' },
  facturada:  { label: 'Facturada',  color: 'blue'  },
  pagada:     { label: 'Pagada',     color: 'green' },
  rechazada:  { label: 'Rechazada', color: 'red'   },
}

const emptyActa = {
  contrato_id: '', numero_acta: '', fecha: '',
  estado: 'pendiente', numero_factura: '', fecha_pago: null, notas: ''
}

async function extraerItemsActaIA(archivo, contrato, itemsContrato) {
  const base64 = await new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = () => res(reader.result.split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(archivo)
  })
  const esImagen = archivo.type.startsWith('image/')
  const mimeType = archivo.type || 'application/pdf'
  const itemsStr = itemsContrato.map(i =>
    `- ${i.ref}: ${i.descripcion} | unidad: ${i.unidad} | cant. contrato: ${i.cantidad} | vr. unitario sin IVA: ${i.vr_unitario}`
  ).join('\n')

  const prompt = `Eres un asistente que procesa actas de cobro para Santa Lucía Muebles y Pisos S.A.S.
CONTRATO: ${contrato.tipo} | ${contrato.numero || 'Sin número'} | IVA incluido: ${contrato.iva_incluido ? 'Sí' : 'No'} | Factor IVA: ${contrato.factor_iva}
ÍTEMS DEL CONTRATO:
${itemsStr}

Del acta adjunta extrae:
1. numero_acta, fecha_acta (YYYY-MM-DD)
2. Por cada ítem del contrato que aparezca con cantidad > 0:
   - ref, cantidad, vr_unitario_sin_iva

Responde SOLO con JSON:
{"numero_acta":"...","fecha_acta":"YYYY-MM-DD","subtotal":0,"items":[{"ref":"...","cantidad":0,"vr_unitario_sin_iva":0}]}`

  const content = [
    esImagen
      ? { type: 'image',    source: { type: 'base64', media_type: mimeType, data: base64 } }
      : { type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } },
    { type: 'text', text: prompt }
  ]
  const data = await callClaude({ model: 'claude-sonnet-4-6', max_tokens: 3000, messages: [{ role: 'user', content }] })
  if (!data.content?.[0]?.text) throw new Error('Sin respuesta')
  const raw = data.content[0].text.trim()
  const ini = raw.indexOf('{'); let niv = 0, fin = ini
  for (let i = ini; i < raw.length; i++) {
    if (raw[i] === '{') niv++; else if (raw[i] === '}') { niv--; if (!niv) { fin = i+1; break } }
  }
  return JSON.parse(raw.slice(ini, fin))
}

export default function Facturacion({ dbData, setDbData, toast, user }) {
  const {
    actas_facturacion = [], items_acta_facturacion = [],
    contratos = [], proyectos = [], constructoras = [],
    items_contrato = [],
  } = dbData

  const [vista, setVista]           = useState('global')   // global | proyecto | acta
  const [proySel, setProySel]       = useState(null)
  const [actaSel, setActaSel]       = useState(null)
  const [modalActa, setModalActa]   = useState(false)
  const [modalItems, setModalItems] = useState(false)
  const [modalManual, setModalManual] = useState(false)
  const [form, setForm]             = useState(emptyActa)
  const [editId, setEditId]         = useState(null)
  const [delId, setDelId]           = useState(null)

  // IA
  const [archivo, setArchivo]       = useState(null)
  const [extrayendo, setExtrayendo] = useState(false)
  const [parsedItems, setParsedItems] = useState([])
  const [extractInfo, setExtractInfo] = useState(null)
  const [savingItems, setSavingItems] = useState(false)
  const [itemsManual, setItemsManual] = useState([])
  const fileRef = useRef()

  // ── Helpers ───────────────────────────────────────────────
  const totalFactContrato = cid =>
    actas_facturacion.filter(a => a.contrato_id === cid).reduce((s, a) => s + (Number(a.total) || 0), 0)

  const calcTotales = (items, contrato) => {
    const subtotal = items.reduce((s, i) => s + Number(i.cantidad||0) * Number(i.vr_unitario_sin_iva||0), 0)
    const iva = contrato?.tipo === 'instalacion' ? subtotal * 0.10 * 0.19 : subtotal * 0.19
    return { subtotal, iva, total: subtotal + iva }
  }

  // Stats globales por tipo
  const statsPorTipo = ['suministro','instalacion','todo_costo'].map(tipo => {
    const cs = contratos.filter(c => c.tipo === tipo)
    const total = cs.reduce((s,c) => s + (Number(c.valor_total)||0), 0)
    const fact  = cs.reduce((s,c) => s + totalFactContrato(c.id), 0)
    return { tipo, total, facturado: fact, porFact: total - fact, n: cs.length }
  }).filter(s => s.n > 0)

  const totalG   = statsPorTipo.reduce((s,x) => s + x.total, 0)
  const factG    = statsPorTipo.reduce((s,x) => s + x.facturado, 0)
  const porFactG = totalG - factG

  const tipoConfig = {
    suministro:  { label: 'Suministro',  icon: '📦', color: C.bl  },
    instalacion: { label: 'Instalación', icon: '🔧', color: C.am  },
    todo_costo:  { label: 'Todo Costo',  icon: '📋', color: C.or  },
  }

  // Proyectos con contratos
  const proyConContratos = proyectos.filter(p => contratos.some(c => c.proyecto_id === p.id))

  // ── CRUD Acta ─────────────────────────────────────────────
  function openNew(contratoId) {
    setForm({ ...emptyActa, contrato_id: contratoId || '' })
    setEditId(null); setModalActa(true)
  }
  function openEdit(a) { setForm({ ...a, fecha_pago: a.fecha_pago || null }); setEditId(a.id); setModalActa(true) }

  async function guardarActa() {
    if (!form.contrato_id) { toast('Selecciona el contrato', 'err'); return }
    if (!form.fecha)       { toast('Ingresa la fecha', 'err'); return }
    const dataG = { ...form, fecha_pago: form.fecha_pago || null, numero_factura: form.numero_factura || null }
    try {
      if (editId) {
        const { data: u, error } = await supabase.from('actas_facturacion').update(dataG).eq('id', editId).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, actas_facturacion: d.actas_facturacion.map(a => a.id === editId ? u : a) }))
        if (actaSel?.id === editId) setActaSel(u)
        toast('Acta actualizada', 'ok'); setModalActa(false)
      } else {
        const { data: cr, error } = await supabase.from('actas_facturacion').insert(dataG).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, actas_facturacion: [...d.actas_facturacion, cr] }))
        toast('Acta creada', 'ok'); setModalActa(false)
        setActaSel(cr); setVista('acta')
        setTimeout(() => setModalItems(true), 200)
      }
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  async function eliminarActa() {
    try {
      await supabase.from('items_acta_facturacion').delete().eq('acta_facturacion_id', delId)
      await supabase.from('actas_facturacion').delete().eq('id', delId)
      setDbData(d => ({
        ...d,
        actas_facturacion: d.actas_facturacion.filter(a => a.id !== delId),
        items_acta_facturacion: d.items_acta_facturacion.filter(i => i.acta_facturacion_id !== delId),
      }))
      toast('Acta eliminada', 'ok'); setDelId(null)
      if (vista === 'acta') setVista('proyecto')
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  // ── IA ────────────────────────────────────────────────────
  async function handleArchivoChange(e) {
    const f = e.target.files[0]; if (!f) return
    setArchivo(f); setParsedItems([]); setExtractInfo(null)
    setExtrayendo(true)
    try {
      const contrato = contratos.find(c => c.id === actaSel?.contrato_id)
      const its = items_contrato.filter(i => i.contrato_id === actaSel?.contrato_id)
      toast('Analizando acta con IA…', 'info')
      const res = await extraerItemsActaIA(f, contrato, its)
      setParsedItems(res.items || []); setExtractInfo(res)
      if (actaSel && (res.numero_acta || res.fecha_acta)) {
        const upd = {}
        if (res.numero_acta) upd.numero_acta = res.numero_acta
        if (res.fecha_acta)  upd.fecha = res.fecha_acta
        if (Object.keys(upd).length) {
          const { data: u } = await supabase.from('actas_facturacion').update(upd).eq('id', actaSel.id).select().single()
          if (u) { setActaSel(u); setDbData(d => ({ ...d, actas_facturacion: d.actas_facturacion.map(a => a.id === u.id ? u : a) })) }
        }
      }
      toast(`${(res.items||[]).length} ítems extraídos`, 'ok')
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setExtrayendo(false)
  }

  async function guardarItemsIA() {
    const contrato = contratos.find(c => c.id === actaSel?.contrato_id)
    const { subtotal, iva, total } = calcTotales(parsedItems, contrato)
    setSavingItems(true)
    try {
      await supabase.from('items_acta_facturacion').delete().eq('acta_facturacion_id', actaSel.id)
      const rows = parsedItems.map(it => {
        const ic = items_contrato.find(i => i.ref === it.ref && i.contrato_id === actaSel.contrato_id)
        const vr = Number(it.vr_unitario_sin_iva||0)
        const ivaI = contrato?.tipo === 'instalacion' ? vr * 0.10 * 0.19 : vr * 0.19
        return { acta_facturacion_id: actaSel.id, item_contrato_id: ic?.id||null, cantidad: Number(it.cantidad||0), vr_unitario_sin_iva: vr, iva: ivaI * Number(it.cantidad||0), vr_total: (vr+ivaI)*Number(it.cantidad||0) }
      })
      const { data: its, error: e1 } = await supabase.from('items_acta_facturacion').insert(rows).select()
      if (e1) throw e1
      const { data: actaU, error: e2 } = await supabase.from('actas_facturacion').update({ subtotal, iva, total }).eq('id', actaSel.id).select().single()
      if (e2) throw e2
      setDbData(d => ({ ...d, actas_facturacion: d.actas_facturacion.map(a => a.id === actaSel.id ? actaU : a), items_acta_facturacion: [...d.items_acta_facturacion.filter(i => i.acta_facturacion_id !== actaSel.id), ...its] }))
      setActaSel(actaU); toast('Acta guardada', 'ok'); setModalItems(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSavingItems(false)
  }

  function abrirManual() {
    const its = items_contrato.filter(i => i.contrato_id === actaSel?.contrato_id)
    setItemsManual(its.map(i => ({ ref: i.ref, descripcion: i.descripcion, unidad: i.unidad, cantidad: '', vr_unitario_sin_iva: i.vr_unitario||'' })))
    setModalItems(false); setModalManual(true)
  }

  async function guardarItemsManual() {
    const validos = itemsManual.filter(i => Number(i.cantidad) > 0)
    if (!validos.length) { toast('Ingresa al menos una cantidad', 'err'); return }
    const contrato = contratos.find(c => c.id === actaSel?.contrato_id)
    const { subtotal, iva, total } = calcTotales(validos, contrato)
    setSavingItems(true)
    try {
      await supabase.from('items_acta_facturacion').delete().eq('acta_facturacion_id', actaSel.id)
      const rows = validos.map(it => {
        const ic = items_contrato.find(i => i.ref === it.ref && i.contrato_id === actaSel.contrato_id)
        const vr = Number(it.vr_unitario_sin_iva||0)
        const ivaI = contrato?.tipo === 'instalacion' ? vr * 0.10 * 0.19 : vr * 0.19
        return { acta_facturacion_id: actaSel.id, item_contrato_id: ic?.id||null, cantidad: Number(it.cantidad), vr_unitario_sin_iva: vr, iva: ivaI*Number(it.cantidad), vr_total: (vr+ivaI)*Number(it.cantidad) }
      })
      const { data: its, error: e1 } = await supabase.from('items_acta_facturacion').insert(rows).select()
      if (e1) throw e1
      const { data: actaU, error: e2 } = await supabase.from('actas_facturacion').update({ subtotal, iva, total }).eq('id', actaSel.id).select().single()
      if (e2) throw e2
      setDbData(d => ({ ...d, actas_facturacion: d.actas_facturacion.map(a => a.id === actaSel.id ? actaU : a), items_acta_facturacion: [...d.items_acta_facturacion.filter(i => i.acta_facturacion_id !== actaSel.id), ...its] }))
      setActaSel(actaU); toast('Acta guardada', 'ok'); setModalManual(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSavingItems(false)
  }

  // ── RENDER ────────────────────────────────────────────────
  return (
    <div>
      {/* ══ VISTA GLOBAL ══ */}
      {vista === 'global' && (
        <div>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Facturación 🔒</h1>
            <p style={{ color: C.g5, marginTop: 4, fontSize: 14 }}>Selecciona un proyecto para gestionar sus actas</p>
          </div>

          {/* Stats globales */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
            <div style={{ ...card, padding: '14px 18px' }}>
              <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Total contratos</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(totalG)}</div>
            </div>
            <div style={{ ...card, padding: '14px 18px' }}>
              <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Facturado</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.gnD }}>{fmt(factG)}</div>
              <div style={{ fontSize: 12, color: C.g5 }}>{totalG > 0 ? Math.round(factG/totalG*100) : 0}% del total</div>
            </div>
            <div style={{ ...card, padding: '14px 18px' }}>
              <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Por facturar</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.am }}>{fmt(porFactG)}</div>
              <div style={{ fontSize: 12, color: C.g5 }}>{actas_facturacion.length} actas · {actas_facturacion.filter(a=>a.estado==='pagada').length} pagadas</div>
            </div>
          </div>

          {/* Stats por tipo */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${statsPorTipo.length},1fr)`, gap: 12, marginBottom: 28 }}>
            {statsPorTipo.map(s => {
              const cfg = tipoConfig[s.tipo]
              const pct = s.total > 0 ? Math.round(s.facturado/s.total*100) : 0
              return (
                <div key={s.tipo} style={{ ...card, padding: '14px 16px', borderTop: `3px solid ${cfg.color}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span>{cfg.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{cfg.label}</span>
                    <span style={{ fontSize: 11, color: C.g4, marginLeft: 'auto' }}>{s.n} contrato(s)</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: C.g4, marginBottom: 2 }}>CONTRATO</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(s.total)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: C.g4, marginBottom: 2 }}>FACTURADO</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.gnD }}>{fmt(s.facturado)}</div>
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                      <div style={{ fontSize: 10, color: C.g4, marginBottom: 2 }}>POR FACTURAR</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.am }}>{fmt(s.porFact)}</div>
                    </div>
                  </div>
                  <div style={{ height: 6, background: C.g1, borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: cfg.color, borderRadius: 10 }} />
                  </div>
                  <div style={{ fontSize: 11, color: C.g5, marginTop: 4, textAlign: 'right' }}>{pct}% facturado</div>
                </div>
              )
            })}
          </div>

          {/* Lista de proyectos */}
          <div style={{ fontSize: 11, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>
            Proyectos
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px,1fr))', gap: 10 }}>
            {proyConContratos.map(p => {
              const constrNom = constructoras.find(c => c.id === p.constructora_id)?.nombre || '—'
              const cP = contratos.filter(c => c.proyecto_id === p.id)
              const tC = cP.reduce((s,c) => s + (Number(c.valor_total)||0), 0)
              const tF = cP.reduce((s,c) => s + totalFactContrato(c.id), 0)
              const pct = tC > 0 ? (tF/tC)*100 : 0
              const nActas = actas_facturacion.filter(a => cP.some(c => c.id === a.contrato_id)).length
              return (
                <div key={p.id} style={{
                  ...card, cursor: 'pointer',
                  borderLeft: `4px solid ${C.or}`,
                }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.1)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.06)'}
                  onClick={() => { setProySel(p); setVista('proyecto') }}
                >
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{p.nombre}</div>
                  <div style={{ fontSize: 12, color: C.g5, marginBottom: 10 }}>
                    🏢 {constrNom} · {cP.length} contrato(s) · {nActas} acta(s)
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: C.g5 }}>{fmt(tC)}</span>
                    <span style={{ color: C.gnD, fontWeight: 600 }}>{Math.round(pct)}% facturado</span>
                  </div>
                  <div style={{ height: 6, background: C.g1, borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: C.or, borderRadius: 10 }} />
                  </div>
                </div>
              )
            })}
            {proyConContratos.length === 0 && (
              <Empty icon="🧾" title="Sin proyectos con contratos" desc="Crea contratos en los proyectos para gestionar facturación." />
            )}
          </div>
        </div>
      )}

      {/* ══ VISTA PROYECTO ══ */}
      {vista === 'proyecto' && proySel && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <Btn onClick={() => { setVista('global'); setProySel(null) }}>← Facturación</Btn>
            <div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{proySel.nombre}</h1>
              <div style={{ fontSize: 13, color: C.g5 }}>
                {constructoras.find(c => c.id === proySel.constructora_id)?.nombre}
              </div>
            </div>
          </div>

          {/* Contratos del proyecto */}
          {contratos.filter(c => c.proyecto_id === proySel.id).map(contrato => {
            const actas = actas_facturacion.filter(a => a.contrato_id === contrato.id)
              .sort((a,b) => new Date(b.fecha) - new Date(a.fecha))
            const totalFact = totalFactContrato(contrato.id)
            const pct = Number(contrato.valor_total) > 0 ? (totalFact/Number(contrato.valor_total))*100 : 0
            const tipo = contrato.tipo === 'suministro' ? '📦 Suministro' : contrato.tipo === 'instalacion' ? '🔧 Instalación' : '📋 Todo Costo'
            const cfg = tipoConfig[contrato.tipo] || tipoConfig.suministro

            return (
              <div key={contrato.id} style={{ marginBottom: 28 }}>
                {/* Header contrato */}
                <div style={{ ...card, padding: '14px 18px', marginBottom: 12, borderTop: `3px solid ${cfg.color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{tipo}</span>
                      {contrato.numero && <span style={{ fontSize: 13, color: C.g4, marginLeft: 10 }}>#{contrato.numero}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 18, fontWeight: 800 }}>{fmt(contrato.valor_total)}</div>
                        <div style={{ fontSize: 12, color: C.gnD }}>{fmt(totalFact)} facturado</div>
                      </div>
                      <Btn variant="primary" onClick={() => openNew(contrato.id)}>+ Nueva acta</Btn>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ flex: 1, height: 8, background: C.g1, borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: cfg.color, borderRadius: 10 }} />
                    </div>
                    <span style={{ fontSize: 12, color: C.g5, whiteSpace: 'nowrap' }}>{Math.round(pct)}% · Por facturar: {fmt(Number(contrato.valor_total) - totalFact)}</span>
                  </div>
                </div>

                {/* Actas del contrato */}
                {actas.length === 0 ? (
                  <div style={{ ...card, textAlign: 'center', color: C.g4, padding: '1.5rem', fontSize: 13 }}>
                    Sin actas — <span style={{ color: C.or, cursor: 'pointer' }} onClick={() => openNew(contrato.id)}>crear primera acta</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {actas.map(a => {
                      const est = ESTADOS_ACTA[a.estado] || ESTADOS_ACTA.pendiente
                      const nItems = items_acta_facturacion.filter(i => i.acta_facturacion_id === a.id).length
                      return (
                        <div key={a.id} style={{
                          ...card, cursor: 'pointer',
                          display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center',
                          borderLeft: `4px solid ${a.estado==='pagada'?C.gn:a.estado==='facturada'?C.bl:a.estado==='rechazada'?C.rd:C.am}`,
                        }}
                          onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.1)'}
                          onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.06)'}
                          onClick={() => { setActaSel(a); setVista('acta') }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                              <span style={{ fontWeight: 700, fontSize: 15 }}>Acta {a.numero_acta || '—'}</span>
                              <Badge color={est.color}>{est.label}</Badge>
                              {nItems > 0 && <span style={{ fontSize: 12, color: C.g5 }}>{nItems} ítems</span>}
                            </div>
                            <div style={{ fontSize: 13, color: C.g5 }}>
                              📅 {fmtDate(a.fecha)}
                              {a.numero_factura && ` · 🧾 ${a.numero_factura}`}
                              {a.fecha_pago && ` · 💳 Pagada: ${fmtDate(a.fecha_pago)}`}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', minWidth: 160 }}>
                            <div style={{ fontSize: 20, fontWeight: 800, color: C.gnD }}>{fmt(a.total)}</div>
                            <div style={{ fontSize: 12, color: C.g5 }}>subtotal: {fmt(a.subtotal)}</div>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }} onClick={e => e.stopPropagation()}>
                              <Btn size="sm" onClick={() => openEdit(a)}>Editar</Btn>
                              <Btn size="sm" variant="danger" onClick={() => setDelId(a.id)}>Eliminar</Btn>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ══ VISTA ACTA ══ */}
      {vista === 'acta' && actaSel && (() => {
        const contrato = contratos.find(c => c.id === actaSel.contrato_id)
        const itsActa  = items_acta_facturacion.filter(i => i.acta_facturacion_id === actaSel.id)
        const itsContr = items_contrato.filter(i => i.contrato_id === actaSel.contrato_id)
        const est = ESTADOS_ACTA[actaSel.estado] || ESTADOS_ACTA.pendiente

        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
              <Btn onClick={() => { setVista('proyecto'); setActaSel(null) }}>← {proySel?.nombre}</Btn>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Acta {actaSel.numero_acta || '—'}</h1>
                  <Badge color={est.color}>{est.label}</Badge>
                </div>
                <div style={{ fontSize: 13, color: C.g5, marginTop: 4 }}>
                  {contrato?.tipo === 'suministro' ? '📦' : '🔧'} {contrato?.tipo} #{contrato?.numero} · {fmtDate(actaSel.fecha)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn onClick={abrirManual}>✏️ Manual</Btn>
                <Btn onClick={() => { setArchivo(null); setParsedItems([]); setExtractInfo(null); setModalItems(true) }}>📎 Cargar PDF/Foto</Btn>
                <Btn onClick={() => openEdit(actaSel)}>Editar acta</Btn>
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Subtotal', value: fmt(actaSel.subtotal), color: C.bk },
                { label: `IVA ${contrato?.tipo==='instalacion'?'1.9%':'19%'}`, value: fmt(actaSel.iva), color: C.g5 },
                { label: 'Total acta', value: fmt(actaSel.total), color: C.gnD },
                { label: 'Acumulado contrato', value: fmt(totalFactContrato(actaSel.contrato_id)), color: C.or, sub: `de ${fmt(contrato?.valor_total)}` },
              ].map((s,i) => (
                <div key={i} style={{ ...card, padding: '12px 16px' }}>
                  <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                  {s.sub && <div style={{ fontSize: 11, color: C.g5 }}>{s.sub}</div>}
                </div>
              ))}
            </div>

            {itsActa.length === 0 ? (
              <Empty icon="🧾" title="Sin ítems" desc="Carga el PDF/foto del acta o ingresa manualmente."
                action={<div style={{ display:'flex',gap:8,justifyContent:'center' }}>
                  <Btn variant="primary" onClick={() => { setArchivo(null); setParsedItems([]); setExtractInfo(null); setModalItems(true) }}>📎 Cargar PDF/Foto</Btn>
                  <Btn onClick={abrirManual}>✏️ Manual</Btn>
                </div>} />
            ) : (
              <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: C.g0 }}>
                      {['Ref','Descripción','UM','Cant.','Vr. sin IVA','IVA','Total'].map((h,i) => (
                        <th key={i} style={{ padding:'10px 12px', textAlign:i>2?'right':'left', fontSize:11, fontWeight:700, color:C.g5, textTransform:'uppercase', letterSpacing:'.06em', borderBottom:`2px solid ${C.g2}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {itsActa.map((it,i) => {
                      const ic = itsContr.find(x => x.id === it.item_contrato_id)
                      return (
                        <tr key={it.id||i} style={{ borderBottom:`1px solid ${C.g1}` }}>
                          <td style={{ padding:'9px 12px', fontWeight:600, color:C.or }}>{ic?.ref||'—'}</td>
                          <td style={{ padding:'9px 12px', maxWidth:300 }}>{ic?.descripcion||'—'}</td>
                          <td style={{ padding:'9px 12px', color:C.g5 }}>{ic?.unidad||'—'}</td>
                          <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:600 }}>{Number(it.cantidad).toLocaleString('es-CO')}</td>
                          <td style={{ padding:'9px 12px', textAlign:'right' }}>{fmt(it.vr_unitario_sin_iva)}</td>
                          <td style={{ padding:'9px 12px', textAlign:'right', color:C.g5 }}>{fmt(it.iva)}</td>
                          <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:600 }}>{fmt(it.vr_total)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:C.g0, borderTop:`1px solid ${C.g2}` }}>
                      <td colSpan={5} style={{ padding:'9px 12px', textAlign:'right', fontWeight:600, color:C.g5 }}>SUBTOTAL</td>
                      <td colSpan={2} style={{ padding:'9px 12px', textAlign:'right', fontWeight:600 }}>{fmt(actaSel.subtotal)}</td>
                    </tr>
                    <tr style={{ background:C.g0 }}>
                      <td colSpan={5} style={{ padding:'9px 12px', textAlign:'right', fontWeight:600, color:C.g5 }}>IVA {contrato?.tipo==='instalacion'?'1.9%':'19%'}</td>
                      <td colSpan={2} style={{ padding:'9px 12px', textAlign:'right', color:C.g5 }}>{fmt(actaSel.iva)}</td>
                    </tr>
                    <tr style={{ background:C.g0, borderTop:`1px solid ${C.g2}` }}>
                      <td colSpan={5} style={{ padding:'10px 12px', textAlign:'right', fontWeight:800 }}>TOTAL CON IVA</td>
                      <td colSpan={2} style={{ padding:'10px 12px', textAlign:'right', fontWeight:800, color:C.gnD, fontSize:15 }}>{fmt(actaSel.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ══ MODALES ══ */}
      {/* Modal crear/editar acta */}
      {modalActa && (
        <Modal title={editId ? 'Editar acta' : 'Nueva acta'} onClose={() => setModalActa(false)} wide>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
            <div style={{ gridColumn:'1/-1' }}>
              <Sel label="Contrato *" value={form.contrato_id} onChange={e => setForm(f => ({ ...f, contrato_id: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                {contratos.filter(c => !proySel || c.proyecto_id === proySel.id).map(c => {
                  const p = proyectos.find(x => x.id === c.proyecto_id)
                  return <option key={c.id} value={c.id}>{p?.nombre} — {c.tipo} {c.numero?`#${c.numero}`:''}</option>
                })}
              </Sel>
            </div>
            <Inp label="Número de acta" value={form.numero_acta||''} onChange={e => setForm(f => ({ ...f, numero_acta: e.target.value }))} placeholder="Ej: 7, EA33003561..." />
            <Inp label="Fecha *" type="date" value={form.fecha||''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            <Sel label="Estado" value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
              {Object.entries(ESTADOS_ACTA).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </Sel>
            <Inp label="Número de factura" value={form.numero_factura||''} onChange={e => setForm(f => ({ ...f, numero_factura: e.target.value }))} />
            <Inp label="Fecha de pago" type="date" value={form.fecha_pago||''} onChange={e => setForm(f => ({ ...f, fecha_pago: e.target.value||null }))} />
            <div style={{ gridColumn:'1/-1' }}>
              <Txt label="Notas" value={form.notas||''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:8 }}>
            <Btn onClick={() => setModalActa(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardarActa}>{editId ? 'Guardar' : 'Crear y cargar ítems →'}</Btn>
          </div>
        </Modal>
      )}

      {/* Modal cargar PDF */}
      {modalItems && (
        <Modal title="Cargar acta — PDF o foto" onClose={() => setModalItems(false)} wide>
          <div onClick={() => fileRef.current?.click()} style={{
            border:`2px dashed ${archivo?C.gnD:C.g3}`, borderRadius:12,
            padding:'2rem', textAlign:'center', cursor:'pointer',
            background:archivo?C.gnL:C.g0, marginBottom:16,
          }}>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:'none' }} onChange={handleArchivoChange} />
            {extrayendo ? (
              <div>
                <div style={{ width:36, height:36, border:`3px solid ${C.g2}`, borderTopColor:C.or, borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                <div style={{ fontWeight:600, color:C.or }}>Analizando con IA…</div>
              </div>
            ) : archivo ? (
              <div><div style={{ fontSize:32, marginBottom:8 }}>✅</div><div style={{ fontWeight:600, color:C.gnD }}>{archivo.name}</div></div>
            ) : (
              <div><div style={{ fontSize:40, marginBottom:8 }}>📎</div><div style={{ fontWeight:600 }}>Arrastra el PDF o foto del acta</div><div style={{ fontSize:13, color:C.g5, marginTop:6 }}>PDF, JPG, PNG · cualquier formato</div></div>
            )}
          </div>
          {extractInfo && !extrayendo && (
            <div style={{ background:C.gnL, border:`1px solid #BBF7D0`, borderRadius:8, padding:'10px 14px', marginBottom:12, fontSize:13, color:C.gnD }}>
              ✓ {parsedItems.length} ítems{extractInfo.numero_acta?` · Acta ${extractInfo.numero_acta}`:''}
              {extractInfo.fecha_acta?` · ${fmtDate(extractInfo.fecha_acta)}`:''}
            </div>
          )}
          {parsedItems.length > 0 && (
            <div style={{ maxHeight:280, overflowY:'auto', border:`1px solid ${C.g2}`, borderRadius:8, marginBottom:16 }}>
              <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse' }}>
                <thead style={{ background:C.g0, position:'sticky', top:0 }}>
                  <tr>{['Ref','Cant.','Vr. sin IVA','Total'].map((h,i) => <th key={i} style={{ padding:'8px 10px', textAlign:i>0?'right':'left', fontSize:11, color:C.g5, fontWeight:700, borderBottom:`1px solid ${C.g2}` }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {parsedItems.map((it,i) => <tr key={i} style={{ borderTop:`1px solid ${C.g1}` }}>
                    <td style={{ padding:'7px 10px', fontWeight:600, color:C.or }}>{it.ref}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' }}>{it.cantidad}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right' }}>{fmt(it.vr_unitario_sin_iva)}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:600 }}>{fmt(Number(it.cantidad)*Number(it.vr_unitario_sin_iva))}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ borderTop:`1px solid ${C.g2}`, paddingTop:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <Btn onClick={abrirManual}>✏️ Manual</Btn>
            <div style={{ display:'flex', gap:10 }}>
              <Btn onClick={() => setModalItems(false)}>Cancelar</Btn>
              {parsedItems.length > 0 && <Btn variant="primary" onClick={guardarItemsIA} disabled={savingItems}>{savingItems?'Guardando…':`✓ Guardar ${parsedItems.length} ítems`}</Btn>}
            </div>
          </div>
        </Modal>
      )}

      {/* Modal ingreso manual */}
      {modalManual && (
        <Modal title="Ítems del acta — manual" onClose={() => setModalManual(false)} wide fullscreen>
          <div style={{ maxHeight:420, overflowY:'auto', border:`1px solid ${C.g2}`, borderRadius:8, marginBottom:16 }}>
            <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse' }}>
              <thead style={{ background:C.g0, position:'sticky', top:0 }}>
                <tr>{['Ref','Descripción','UM','Cant. contrato','Cantidad acta','Vr. sin IVA'].map((h,i) => <th key={i} style={{ padding:'9px 10px', textAlign:i>2?'right':'left', fontSize:11, fontWeight:700, color:C.g5, borderBottom:`2px solid ${C.g2}`, whiteSpace:'nowrap' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {itemsManual.map((row,i) => (
                  <tr key={i} style={{ borderBottom:`1px solid ${C.g1}`, background:Number(row.cantidad)>0?'#F0FDF4':'' }}>
                    <td style={{ padding:'7px 10px', fontWeight:600, color:C.or }}>{row.ref}</td>
                    <td style={{ padding:'7px 10px', fontSize:12, maxWidth:260 }}>{row.descripcion}</td>
                    <td style={{ padding:'7px 10px', color:C.g5 }}>{row.unidad}</td>
                    <td style={{ padding:'7px 10px', textAlign:'right', color:C.g4 }}>{Number(items_contrato.find(x=>x.ref===row.ref&&x.contrato_id===actaSel?.contrato_id)?.cantidad||0).toLocaleString('es-CO')}</td>
                    <td style={{ padding:'7px 10px', width:100 }}>
                      <input type="number" value={row.cantidad} onChange={e => setItemsManual(rows => rows.map((r,j) => j===i?{...r,cantidad:e.target.value}:r))}
                        placeholder="0" style={{ width:'100%', padding:'4px 8px', border:`1px solid ${Number(row.cantidad)>0?C.gnD:C.g2}`, borderRadius:6, fontSize:13, textAlign:'right', outline:'none' }} />
                    </td>
                    <td style={{ padding:'7px 10px', width:120 }}>
                      <input type="number" value={row.vr_unitario_sin_iva} onChange={e => setItemsManual(rows => rows.map((r,j) => j===i?{...r,vr_unitario_sin_iva:e.target.value}:r))}
                        style={{ width:'100%', padding:'4px 8px', border:`1px solid ${C.g2}`, borderRadius:6, fontSize:13, textAlign:'right', outline:'none' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {itemsManual.some(i => Number(i.cantidad)>0) && (() => {
            const c = contratos.find(x => x.id === actaSel?.contrato_id)
            const { subtotal, iva, total } = calcTotales(itemsManual.filter(i=>Number(i.cantidad)>0), c)
            return <div style={{ ...card, background:C.g0, padding:'12px 16px', marginBottom:16, display:'flex', gap:24 }}>
              <span style={{ fontSize:13 }}>Subtotal: <strong>{fmt(subtotal)}</strong></span>
              <span style={{ fontSize:13, color:C.g5 }}>IVA: <strong>{fmt(iva)}</strong></span>
              <span style={{ fontSize:14, color:C.gnD, fontWeight:700 }}>Total: <strong>{fmt(total)}</strong></span>
            </div>
          })()}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
            <Btn onClick={() => setModalManual(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardarItemsManual} disabled={savingItems}>{savingItems?'Guardando…':'✓ Guardar acta'}</Btn>
          </div>
        </Modal>
      )}

      {/* Confirmar eliminar */}
      {delId && (
        <Modal title="Eliminar acta" onClose={() => setDelId(null)}>
          <p style={{ fontSize:14, marginBottom:8 }}>¿Eliminar esta acta y todos sus ítems?</p>
          <p style={{ fontSize:13, color:C.rd, marginBottom:20 }}>Esta acción no se puede deshacer.</p>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
            <Btn onClick={() => setDelId(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={eliminarActa}>Sí, eliminar</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
