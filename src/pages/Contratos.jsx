import { callClaude } from '../lib/api.js'
import { useState, useRef } from 'react'
import { C, Btn, Inp, Sel, Txt, Modal, Badge, Empty, SectionHeader, card, fmt, fmtDate, Progress } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

const emptyContrato = {
  proyecto_id: '', numero: '', tipo: 'suministro',
  valor_total: '', fecha_inicio: '', fecha_fin: '',
  iva_incluido: true, factor_iva: 1.19, estado: 'vigente', notas: ''
}

const TIPOS = {
  suministro:  { label: 'Suministro',  icon: '📦', color: 'blue'  },
  instalacion: { label: 'Instalación', icon: '🔧', color: 'amber' },
  todo_costo:  { label: 'Todo Costo',  icon: '📋', color: 'orange'},
}

const ESTADOS_C = {
  vigente:   { label: 'Vigente',   color: 'green' },
  liquidado: { label: 'Liquidado', color: 'gray'  },
  cancelado: { label: 'Cancelado', color: 'red'   },
}

// ── Extractor de ítems con IA ──────────────────────────────
async function extraerItemsConIA(archivo, tipoContrato) {
  const base64 = await new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = () => res(reader.result.split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(archivo)
  })

  const esImagen = archivo.type.startsWith('image/')
  const mimeType = archivo.type || 'application/pdf'

  const prompt = `Eres un asistente especializado en contratos de carpintería y construcción colombianos.
Del documento adjunto extrae TODOS los ítems del cuadro de cantidades de obra.

REGLAS CRÍTICAS:
- Extrae CADA fila del cuadro de cantidades como un ítem separado
- ref: código corto descriptivo (ej: P-01, CLOSET-01, ZOC, VEST-01, MUCAMAS-P2)
- descripcion: descripción resumida del ítem, MÁXIMO 100 caracteres (quita repeticiones y detalles de referencia)
- unidad: unidad de medida exacta (un, ml, m2, gl, apto, etc.)
- cantidad: número exacto de la columna CANTIDAD
- vr_unitario: valor UNITARIO tal como aparece en el contrato (no el total)
- Si el cuadro NO tiene fila de SUBTOTAL/IVA/TOTAL al pie → iva_incluido: true
- Si SÍ tiene SUBTOTAL + IVA + TOTAL discriminados al pie → iva_incluido: false
- NO incluyas filas de subtotal, IVA, total ni encabezados
- Mantén el orden original del contrato

Responde SOLO con JSON válido sin texto adicional:
{
  "numero_contrato": "número si aparece, sino null",
  "valor_total": número total del contrato con IVA,
  "iva_incluido": true o false,
  "items": [
    {"ref": "P-01", "descripcion": "descripción completa", "unidad": "un", "cantidad": 122, "vr_unitario": 499790},
    {"ref": "P-02", "descripcion": "...", "unidad": "un", "cantidad": 22, "vr_unitario": 499790}
  ]
}`

  const content = [
    esImagen
      ? { type: 'image',    source: { type: 'base64', media_type: mimeType, data: base64 } }
      : { type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } },
    { type: 'text', text: prompt }
  ]

  const data = await callClaude({ model: 'claude-sonnet-4-6', max_tokens: 16000, messages: [{ role: 'user', content }] })
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
  if (!data.content?.[0]?.text) throw new Error('Sin respuesta de la IA')
  if (data.stop_reason === 'max_tokens') {
    throw new Error('El cuadro es muy largo y la respuesta quedó cortada. Pegá el cuadro desde Excel o subí el PDF por partes.')
  }

  const raw = data.content[0].text.trim()
  const inicio = raw.indexOf('{')
  let nivel = 0, fin = inicio
  for (let i = inicio; i < raw.length; i++) {
    if (raw[i] === '{') nivel++
    else if (raw[i] === '}') { nivel--; if (nivel === 0) { fin = i + 1; break } }
  }
  try {
    return JSON.parse(raw.slice(inicio, fin))
  } catch {
    // Si el JSON quedó incompleto, se rescatan los ítems que sí alcanzaron a llegar
    const items = []
    const re = /\{[^{}]*"ref"[^{}]*\}/g
    let m
    while ((m = re.exec(raw)) !== null) { try { items.push(JSON.parse(m[0])) } catch {} }
    if (!items.length) throw new Error('La IA respondió en un formato que no se pudo leer')
    return { items, parcial: true }
  }
}

export default function Contratos({ dbData, setDbData, toast, nav, irA }) {
  const { contratos = [], proyectos = [], constructoras = [], items_contrato = [], actas_facturacion = [] } = dbData
  const navContrato = nav?.contratoId ? contratos.find(c => c.id === nav.contratoId) : null

  const [vista, setVista]             = useState(navContrato ? 'detalle' : 'lista')
  const [contratoSel, setContratoSel] = useState(navContrato || null)
  const [modalContrato, setModalContrato] = useState(false)
  const [modalItems, setModalItems]       = useState(false)
  const [editandoCant, setEditandoCant]   = useState(null)
  const [cantEdit, setCantEdit]           = useState('')
  const [form, setForm]               = useState(emptyContrato)
  const [editId, setEditId]           = useState(null)
  const [delId, setDelId]             = useState(null)
  const [filtProy, setFiltProy]       = useState('')
  const [filtTipo, setFiltTipo]       = useState('')

  // Estado modal ítems
  const [archivo, setArchivo]         = useState(null)
  const [extrayendo, setExtrayendo]   = useState(false)
  const [parsedItems, setParsedItems] = useState([])
  const [extractInfo, setExtractInfo] = useState(null)
  const [savingItems, setSavingItems] = useState(false)
  const [editItems, setEditItems]     = useState(false)
  const [pegado, setPegado]           = useState('')
  const fileRef = useRef()

  // ── Helpers ───────────────────────────────────────────────
  const proyectoName   = id => proyectos.find(p => p.id === id)?.nombre || '—'
  const constructoraName = pid => {
    const p = proyectos.find(x => x.id === pid)
    return constructoras.find(c => c.id === p?.constructora_id)?.nombre || '—'
  }
  const pctFacturado = cid => {
    const c = contratos.find(x => x.id === cid)
    if (!c?.valor_total) return 0
    const f = actas_facturacion.filter(a => a.contrato_id === cid).reduce((s, a) => s + (Number(a.total) || 0), 0)
    return (f / Number(c.valor_total)) * 100
  }
  const totalFacturado = cid => actas_facturacion.filter(a => a.contrato_id === cid).reduce((s, a) => s + (Number(a.total) || 0), 0)

  const filtered = contratos.filter(c => {
    return (!filtProy || c.proyecto_id === filtProy) && (!filtTipo || c.tipo === filtTipo)
  })

  // ── CRUD Contrato ─────────────────────────────────────────
  function openNew()   { setForm({ ...emptyContrato }); setEditId(null); setModalContrato(true) }
  function openEdit(c) { setForm({ ...c, valor_total: c.valor_total || '' }); setEditId(c.id); setModalContrato(true) }

  async function guardarContrato() {
    if (!form.proyecto_id) { toast('Selecciona el proyecto', 'err'); return }
    const data = {
      ...form,
      valor_total: Number(String(form.valor_total).replace(/[^0-9.]/g, '')) || 0,
      factor_iva: form.tipo === 'instalacion' ? 1.019 : 1.19,
    }
    try {
      if (editId) {
        const { data: u, error } = await supabase.from('contratos').update(data).eq('id', editId).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, contratos: d.contratos.map(c => c.id === editId ? u : c) }))
        toast('Contrato actualizado', 'ok')
        setModalContrato(false)
      } else {
        const { data: cr, error } = await supabase.from('contratos').insert(data).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, contratos: [...d.contratos, cr] }))
        toast('Contrato creado', 'ok')
        setModalContrato(false)
        // Abrir detalle para cargar ítems
        setContratoSel(cr)
        setVista('detalle')
        setTimeout(() => setModalItems(true), 200)
      }
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  async function eliminarContrato() {
    try {
      await supabase.from('items_contrato').delete().eq('contrato_id', delId)
      const { error } = await supabase.from('contratos').delete().eq('id', delId)
      if (error) throw error
      setDbData(d => ({
        ...d,
        contratos: d.contratos.filter(c => c.id !== delId),
        items_contrato: d.items_contrato.filter(i => i.contrato_id !== delId),
      }))
      toast('Contrato eliminado', 'ok'); setDelId(null)
      if (vista === 'detalle') setVista('lista')
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  // ── Editar cantidad de ítem ───────────────────────────────
  async function guardarCantidad(itemId) {
    const nueva = Number(cantEdit)
    if (isNaN(nueva) || nueva < 0) { toast('Cantidad inválida', 'err'); return }
    try {
      const { data, error } = await supabase.from('items_contrato').update({ cantidad: nueva }).eq('id', itemId).select().single()
      if (error) throw error
      setDbData(d => ({ ...d, items_contrato: d.items_contrato.map(i => i.id === itemId ? data : i) }))
      toast('Cantidad actualizada', 'ok')
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setEditandoCant(null); setCantEdit('')
  }

  // ── Extracción IA ─────────────────────────────────────────
  function abrirModalItems(contrato) {
    setContratoSel(contrato)
    setArchivo(null); setParsedItems([]); setExtractInfo(null); setEditItems(false); setPegado('')
    setModalItems(true)
  }

  async function handleArchivoChange(e) {
    const f = e.target.files[0]
    if (!f) return
    setArchivo(f)
    setParsedItems([]); setExtractInfo(null)
    setExtrayendo(true)
    try {
      toast('Analizando contrato con IA…', 'info')
      const resultado = await extraerItemsConIA(f, contratoSel?.tipo)
      const items = (resultado.items || []).map((it, i) => ({ ...it, orden: i + 1 }))
      setParsedItems(items)
      setExtractInfo(resultado)
      // Si la IA detectó el número y valor total, actualizar el contrato
      if (contratoSel && (resultado.numero_contrato || resultado.valor_total)) {
        const updates = {}
        if (resultado.numero_contrato) updates.numero = resultado.numero_contrato
        if (resultado.valor_total)     updates.valor_total = resultado.valor_total
        if (Object.keys(updates).length) {
          const { data: u } = await supabase.from('contratos').update(updates).eq('id', contratoSel.id).select().single()
          if (u) {
            setContratoSel(u)
            setDbData(d => ({ ...d, contratos: d.contratos.map(c => c.id === u.id ? u : c) }))
          }
        }
      }
      toast(`${items.length} ítems extraídos correctamente`, 'ok')
    } catch (e) {
      toast('Error extrayendo ítems: ' + e.message, 'err')
    }
    setExtrayendo(false)
  }

  async function guardarItems() {
    if (!contratoSel || !parsedItems.length) return
    setSavingItems(true)
    try {
      await supabase.from('items_contrato').delete().eq('contrato_id', contratoSel.id)
      const rows = parsedItems.map(i => ({ ...i, contrato_id: contratoSel.id }))
      const { data, error } = await supabase.from('items_contrato').insert(rows).select()
      if (error) throw error
      setDbData(d => ({
        ...d,
        items_contrato: [...d.items_contrato.filter(i => i.contrato_id !== contratoSel.id), ...data],
      }))
      toast(`${data.length} ítems guardados`, 'ok')
      setModalItems(false)
    } catch (e) { toast('Error guardando: ' + e.message, 'err') }
    setSavingItems(false)
  }

  // ── Pegar el cuadro desde Excel ───────────────────────────
  // Se espera una fila por ítem con: REF, DESCRIPCIÓN, UM, CANTIDAD, VR. UNITARIO
  // (separadas por tabulación, que es como pega Excel). Ignora encabezados y filas sin cantidad.
  function parsearPegado(texto) {
    const num = v => {
      const limpio = String(v || '').replace(/[$\s]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
      const n = Number(limpio)
      return isNaN(n) ? 0 : n
    }
    return texto.split('\n').map(l => l.split('\t')).filter(c => c.length >= 4)
      .map((c, i) => ({
        ref: (c[0] || '').trim(),
        descripcion: (c[1] || '').trim(),
        unidad: (c[2] || 'und').trim() || 'und',
        cantidad: num(c[3]),
        vr_unitario: num(c[4]),
        orden: i + 1,
      }))
      .filter(it => it.ref && it.cantidad > 0)
      .map((it, i) => ({ ...it, orden: i + 1 }))
  }

  function aplicarPegado() {
    const items = parsearPegado(pegado)
    if (!items.length) { toast('No se reconoció ninguna fila. Revisa que copiaste las 5 columnas.', 'err'); return }
    setParsedItems(items)
    setExtractInfo({ manual: true })
    toast(`${items.length} ítems leídos`, 'ok')
  }

  function updateItem(idx, field, val) {
    setParsedItems(items => items.map((it, i) => i === idx ? { ...it, [field]: val } : it))
  }

  // ── Vista detalle ─────────────────────────────────────────
  if (vista === 'detalle' && contratoSel) {
    const items     = items_contrato.filter(i => i.contrato_id === contratoSel.id).sort((a, b) => (a.orden||0)-(b.orden||0))
    const proyecto  = proyectos.find(p => p.id === contratoSel.proyecto_id)
    const constr    = constructoras.find(c => c.id === proyecto?.constructora_id)
    const pct       = pctFacturado(contratoSel.id)
    const facturado = totalFacturado(contratoSel.id)
    const tipo      = TIPOS[contratoSel.tipo] || TIPOS.suministro
    const totalItems = items.reduce((s, i) => s + Number(i.cantidad) * Number(i.vr_unitario), 0)
    const factorIva = contratoSel.factor_iva || (contratoSel.tipo === 'instalacion' ? 1.019 : 1.19)
    // Para instalación: IVA = subtotal × 10% × 19% = subtotal × 0.019
    // Para suministro:  IVA = subtotal × 19%
    // Si iva_incluido: el precio ya tiene IVA dentro, extraerlo
    const ivaItems = contratoSel.iva_incluido
      ? totalItems * (1 - 1/factorIva)
      : contratoSel.tipo === 'instalacion'
        ? totalItems * 0.10 * 0.19
        : totalItems * 0.19
    const totalConIva = contratoSel.iva_incluido ? totalItems : totalItems + ivaItems

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Btn onClick={() => setVista('lista')}>← Contratos</Btn>
          {nav?.desde === 'proyecto' && irA && <Btn variant="primary" onClick={() => irA('proyectos', { proyectoId: nav.proyectoId })}>← Volver al proyecto</Btn>}
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              {tipo.icon} {tipo.label} — {proyecto?.nombre}
            </h1>
            <div style={{ fontSize: 13, color: C.g5 }}>
              {constr?.nombre} · {contratoSel.numero ? `Contrato #${contratoSel.numero}` : 'Sin número'}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Btn onClick={() => abrirModalItems(contratoSel)}>
              {items.length ? '🔄 Recargar ítems' : '+ Cargar ítems desde PDF'}
            </Btn>
            <Btn onClick={() => openEdit(contratoSel)}>Editar contrato</Btn>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
          <div style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Valor contrato</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(contratoSel.valor_total)}</div>
            <div style={{ fontSize: 11, color: C.g5 }}>{items.length} ítems · {contratoSel.tipo}</div>
          </div>
          <div style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Facturado</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.gnD }}>{fmt(facturado)}</div>
          </div>
          <div style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Por facturar</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.am }}>
              {fmt(Number(contratoSel.valor_total) - facturado)}
            </div>
          </div>
          <div style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: C.g4, marginBottom: 6 }}>Avance facturación</div>
            <Progress value={pct} />
          </div>
        </div>

        {/* Tabla ítems */}
        {items.length === 0 ? (
          <Empty icon="📄" title="Sin ítems" desc="Carga el PDF o imagen del contrato para extraer los ítems automáticamente."
            action={<Btn variant="primary" onClick={() => abrirModalItems(contratoSel)}>📎 Cargar contrato (PDF/JPG)</Btn>} />
        ) : (
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.g0 }}>
                  {['#','Ref','Descripción','UM','Cantidad','Vr. Unitario','Total contrato'].map((h,i) => (
                    <th key={i} style={{ padding: '10px 12px', textAlign: i > 3 ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: `2px solid ${C.g2}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id} style={{ borderBottom: `1px solid ${C.g1}` }}>
                    <td style={{ padding: '9px 12px', color: C.g4, fontSize: 12 }}>{item.orden || i+1}</td>
                    <td style={{ padding: '9px 12px', fontWeight: 600, color: C.or, whiteSpace: 'nowrap' }}>{item.ref}</td>
                    <td style={{ padding: '9px 12px', maxWidth: 360 }}>{item.descripcion}</td>
                    <td style={{ padding: '9px 12px', color: C.g5 }}>{item.unidad}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                        {editandoCant === item.id ? (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                            <input type="number" value={cantEdit} onChange={e => setCantEdit(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') guardarCantidad(item.id); if (e.key === 'Escape') setEditandoCant(null) }}
                              autoFocus style={{ width: 80, padding: '3px 6px', border: '1px solid #F97316', borderRadius: 4, fontSize: 12, textAlign: 'right' }} />
                            <button onClick={() => guardarCantidad(item.id)} style={{ background:'#15803D', border:'none', color:'white', borderRadius:4, padding:'3px 8px', cursor:'pointer', fontSize:12 }}>✓</button>
                            <button onClick={() => setEditandoCant(null)} style={{ background:'#D1D1D6', border:'none', borderRadius:4, padding:'3px 8px', cursor:'pointer', fontSize:12 }}>✕</button>
                          </div>
                        ) : (
                          <span onClick={() => { setEditandoCant(item.id); setCantEdit(String(item.cantidad || 0)) }}
                            title="Clic para editar cantidad"
                            style={{ cursor: 'pointer', borderBottom: '1px dashed #C7C7CC', paddingBottom: 1 }}>
                            {Number(item.cantidad).toLocaleString('es-CO')}
                          </span>
                        )}
                      </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>{fmt(item.vr_unitario)}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>{fmt(Number(item.cantidad)*Number(item.vr_unitario))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: C.g0, borderTop: `2px solid ${C.g2}` }}>
                  <td colSpan={6} style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'right', color: C.g5 }}>SUBTOTAL</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>{fmt(totalItems)}</td>
                </tr>
                <tr style={{ background: C.g0 }}>
                  <td colSpan={6} style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'right', color: C.g5 }}>
                    IVA {contratoSel.tipo === 'instalacion' ? '19% sobre utilidad 10% = 1.9%' : '19%'}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: C.g5 }}>{fmt(ivaItems)}</td>
                </tr>
                <tr style={{ background: C.g0, borderTop: `1px solid ${C.g2}` }}>
                  <td colSpan={6} style={{ padding: '10px 12px', fontWeight: 800, textAlign: 'right' }}>TOTAL CON IVA</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: C.gnD, fontSize: 15 }}>{fmt(totalConIva)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Modal cargar ítems con IA */}
        {modalItems && (
          <Modal title="Cargar ítems desde contrato" onClose={() => setModalItems(false)} wide>
            {/* Upload */}
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${archivo ? C.gnD : C.g3}`, borderRadius: 12,
                padding: '2rem', textAlign: 'center', cursor: 'pointer',
                background: archivo ? C.gnL : C.g0, marginBottom: 16,
                transition: 'all .15s',
              }}
            >
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleArchivoChange} />
              {extrayendo ? (
                <div>
                  <div style={{ width: 36, height: 36, border: `3px solid ${C.g2}`, borderTopColor: C.or, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                  <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  <div style={{ fontWeight: 600, color: C.or }}>Analizando contrato con IA…</div>
                  <div style={{ fontSize: 12, color: C.g5, marginTop: 4 }}>Extrayendo todos los ítems del cuadro de cantidades</div>
                </div>
              ) : archivo ? (
                <div>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                  <div style={{ fontWeight: 600, color: C.gnD }}>{archivo.name}</div>
                  <div style={{ fontSize: 12, color: C.g5, marginTop: 4 }}>Clic para cambiar el archivo</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>📎</div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>Arrastra el PDF o imagen del contrato aquí</div>
                  <div style={{ fontSize: 13, color: C.g5, marginTop: 6 }}>o clic para seleccionar · PDF, JPG, PNG</div>
                </div>
              )}
            </div>

            {/* Pegar desde Excel */}
            {!extrayendo && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>…o pegá el cuadro desde Excel</span>
                  <Btn size="sm" onClick={aplicarPegado} disabled={!pegado.trim()}>Leer lo pegado</Btn>
                </div>
                <textarea value={pegado} onChange={e => setPegado(e.target.value)} rows={4}
                  placeholder={'Copiá en Excel las columnas REF, DESCRIPCIÓN, UM, CANTIDAD y VR. UNITARIO (en ese orden) y pegalas acá.\nEj:  P1\tPuerta baño\tund\t430\t607590'}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 12, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
              </div>
            )}

            {/* Info extraída */}
            {extractInfo && !extrayendo && (
              <div style={{ background: C.gnL, border: `1px solid #BBF7D0`, borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
                <strong style={{ color: C.gnD }}>✓ IA extrajo:</strong>
                <span style={{ color: C.gnD, marginLeft: 8 }}>
                  {parsedItems.length} ítems
                  {extractInfo.numero_contrato ? ` · Contrato #${extractInfo.numero_contrato}` : ''}
                  {extractInfo.valor_total ? ` · Total: ${fmt(extractInfo.valor_total)}` : ''}
                  {extractInfo.iva_incluido !== undefined ? ` · IVA ${extractInfo.iva_incluido ? 'incluido' : 'excluido'}` : ''}
                </span>
              </div>
            )}

            {/* Tabla previsualización */}
            {parsedItems.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{parsedItems.length} ítems detectados</span>
                  <Btn size="sm" onClick={() => setEditItems(!editItems)}>
                    {editItems ? '👁️ Ver' : '✏️ Editar'}
                  </Btn>
                </div>
                <div style={{ maxHeight: 340, overflowY: 'auto', border: `1px solid ${C.g2}`, borderRadius: 8, marginBottom: 16 }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead style={{ background: C.g0, position: 'sticky', top: 0 }}>
                      <tr>
                        {['#','Ref','Descripción','UM','Cantidad','Vr. Unitario','Total'].map((h,i) => (
                          <th key={i} style={{ padding: '8px 10px', textAlign: i > 3 ? 'right' : 'left', fontSize: 11, color: C.g5, fontWeight: 700, borderBottom: `1px solid ${C.g2}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedItems.map((it, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${C.g1}` }}>
                          <td style={{ padding: '7px 10px', color: C.g4 }}>{i+1}</td>
                          <td style={{ padding: '7px 10px' }}>
                            {editItems
                              ? <input value={it.ref} onChange={e => updateItem(i,'ref',e.target.value)} style={{ width: 80, padding: '3px 6px', border: `1px solid ${C.g2}`, borderRadius: 4, fontSize: 12 }} />
                              : <span style={{ fontWeight: 600, color: C.or }}>{it.ref}</span>}
                          </td>
                          <td style={{ padding: '7px 10px', maxWidth: 280 }}>
                            {editItems
                              ? <input value={it.descripcion} onChange={e => updateItem(i,'descripcion',e.target.value)} style={{ width: '100%', padding: '3px 6px', border: `1px solid ${C.g2}`, borderRadius: 4, fontSize: 12 }} />
                              : it.descripcion}
                          </td>
                          <td style={{ padding: '7px 10px' }}>
                            {editItems
                              ? <input value={it.unidad} onChange={e => updateItem(i,'unidad',e.target.value)} style={{ width: 50, padding: '3px 6px', border: `1px solid ${C.g2}`, borderRadius: 4, fontSize: 12 }} />
                              : <span style={{ color: C.g5 }}>{it.unidad}</span>}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                            {editItems
                              ? <input type="number" value={it.cantidad} onChange={e => updateItem(i,'cantidad',Number(e.target.value))} style={{ width: 70, padding: '3px 6px', border: `1px solid ${C.g2}`, borderRadius: 4, fontSize: 12, textAlign: 'right' }} />
                              : it.cantidad}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                            {editItems
                              ? <input type="number" value={it.vr_unitario} onChange={e => updateItem(i,'vr_unitario',Number(e.target.value))} style={{ width: 100, padding: '3px 6px', border: `1px solid ${C.g2}`, borderRadius: 4, fontSize: 12, textAlign: 'right' }} />
                              : fmt(it.vr_unitario)}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>
                            {fmt(Number(it.cantidad)*Number(it.vr_unitario))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: C.g0, borderTop: `2px solid ${C.g2}` }}>
                        <td colSpan={6} style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'right', fontSize: 12 }}>TOTAL</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: C.gnD, fontSize: 13 }}>
                          {fmt(parsedItems.reduce((s,i) => s + Number(i.cantidad)*Number(i.vr_unitario), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <Btn onClick={() => setModalItems(false)}>Cancelar</Btn>
              {parsedItems.length > 0 && (
                <Btn variant="primary" onClick={guardarItems} disabled={savingItems}>
                  {savingItems ? 'Guardando…' : `✓ Guardar ${parsedItems.length} ítems`}
                </Btn>
              )}
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // ── Vista lista ───────────────────────────────────────────
  return (
    <div>
      <SectionHeader title="Contratos">
        <Btn variant="primary" onClick={openNew}>+ Nuevo contrato</Btn>
      </SectionHeader>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={filtProy} onChange={e => setFiltProy(e.target.value)}
          style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
          <option value="">Todos los proyectos</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select value={filtTipo} onChange={e => setFiltTipo(e.target.value)}
          style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPOS).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {Object.entries(TIPOS).map(([k,v]) => (
          <div key={k} style={{ ...card, padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span>{v.icon}</span>
            <span style={{ fontSize: 13, color: C.g5 }}>{v.label}</span>
            <span style={{ fontWeight: 700, fontSize: 18 }}>{contratos.filter(c => c.tipo === k).length}</span>
          </div>
        ))}
        <div style={{ ...card, padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center', marginLeft: 'auto' }}>
          <span style={{ fontSize: 13, color: C.g5 }}>Total contratos</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: C.gnD }}>
            {fmt(contratos.reduce((s,c) => s + (Number(c.valor_total)||0), 0))}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty icon="📄" title="Sin contratos" desc="Crea el primer contrato para un proyecto."
          action={<Btn variant="primary" onClick={openNew}>+ Nuevo contrato</Btn>} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(c => {
            const tipo = TIPOS[c.tipo] || TIPOS.suministro
            const est  = ESTADOS_C[c.estado] || ESTADOS_C.vigente
            const pct  = pctFacturado(c.id)
            const nItems = items_contrato.filter(i => i.contrato_id === c.id).length
            return (
              <div key={c.id} style={{
                ...card, cursor: 'pointer',
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center',
                borderLeft: `4px solid ${c.tipo==='suministro'?C.bl:c.tipo==='instalacion'?C.am:C.or}`,
              }}
                onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.1)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.06)'}
                onClick={() => { setContratoSel(c); setVista('detalle') }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 16 }}>{tipo.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{tipo.label}</span>
                    {c.numero && <span style={{ fontSize: 12, color: C.g4 }}>#{c.numero}</span>}
                    <Badge color={est.color}>{est.label}</Badge>
                    {nItems > 0 && <span style={{ fontSize: 12, color: C.g5 }}>{nItems} ítems</span>}
                  </div>
                  <div style={{ fontSize: 13, color: C.g5, marginBottom: 8 }}>
                    🏗️ {proyectoName(c.proyecto_id)} · 🏢 {constructoraName(c.proyecto_id)}
                    {c.fecha_inicio && ` · 📅 ${fmtDate(c.fecha_inicio)}`}
                  </div>
                  <Progress value={pct} />
                </div>
                <div style={{ textAlign: 'right', minWidth: 160 }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(c.valor_total)}</div>
                  <div style={{ fontSize: 12, color: C.gnD, marginBottom: 8 }}>{fmt(totalFacturado(c.id))} facturado</div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                    <Btn size="sm" onClick={() => openEdit(c)}>Editar</Btn>
                    <Btn size="sm" variant="danger" onClick={() => setDelId(c.id)}>Eliminar</Btn>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal crear/editar */}
      {modalContrato && (
        <Modal title={editId ? 'Editar contrato' : 'Nuevo contrato'} onClose={() => setModalContrato(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Sel label="Proyecto *" value={form.proyecto_id} onChange={e => setForm(f => ({ ...f, proyecto_id: e.target.value }))}>
                <option value="">— Seleccionar proyecto —</option>
                {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </Sel>
            </div>
            <Sel label="Tipo *" value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value, factor_iva: e.target.value==='instalacion'?1.019:1.19 }))}>
              {Object.entries(TIPOS).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </Sel>
            <Inp label="Número de contrato" value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} placeholder="Ej: 1320182" />
            <Inp label="Valor total" value={form.valor_total} onChange={e => setForm(f => ({ ...f, valor_total: e.target.value }))} placeholder="535132590" hint="Sin puntos ni comas" />
            <Sel label="Estado" value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
              {Object.entries(ESTADOS_C).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </Sel>
            <div />
            <Inp label="Fecha inicio" type="date" value={form.fecha_inicio||''} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
            <Inp label="Fecha fin" type="date" value={form.fecha_fin||''} onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value }))} />
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, marginBottom: 14 }}>
                <input type="checkbox" checked={form.iva_incluido} onChange={e => setForm(f => ({ ...f, iva_incluido: e.target.checked }))} />
                IVA incluido en el precio unitario
                <span style={{ fontSize: 12, color: C.g4 }}>
                  {form.tipo === 'instalacion' ? '(instalación: IVA 1.9% = 19% sobre utilidad 10%)' : '(suministro: IVA 19%)'}
                </span>
              </label>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <Txt label="Notas" value={form.notas||''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <Btn onClick={() => setModalContrato(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardarContrato}>{editId ? 'Guardar' : 'Crear y cargar ítems →'}</Btn>
          </div>
        </Modal>
      )}

      {/* Confirmar eliminar */}
      {delId && (
        <Modal title="Eliminar contrato" onClose={() => setDelId(null)}>
          <p style={{ fontSize: 14, marginBottom: 8 }}>¿Eliminar este contrato y todos sus ítems?</p>
          <p style={{ fontSize: 13, color: C.rd, marginBottom: 20 }}>Esta acción no se puede deshacer.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Btn onClick={() => setDelId(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={eliminarContrato}>Sí, eliminar</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
