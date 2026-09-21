import { useState } from 'react'
import { C, Btn, Inp, Sel, Txt, Modal, Badge, Empty, SectionHeader, card, fmt, fmtDate, Stat } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

// Estados de un adicional. Se pueden saltar pasos (a veces se hace y después se negocia).
const ESTADOS = {
  pendiente: { label: 'Solicitado', color: 'gray'   },
  cotizado:  { label: 'Cotizado',   color: 'amber'  },
  aprobado:  { label: 'Aprobado',   color: 'blue'   },
  ejecutado: { label: 'Ejecutado',  color: 'orange' },
  cobrado:   { label: 'Cobrado',    color: 'green'  },
  rechazado: { label: 'Rechazado',  color: 'red'    },
}
const SOPORTES = { orden: 'Orden de compra', correo: 'Correo', firma: 'Firma en obra', verbal: 'Verbal', otro: 'Otro' }

const vacio = {
  origen: 'obra', descripcion: '', unidad: 'und', cantidad: 1,
  valor_cobro: '', valor: '', estado: 'pendiente', fecha: '',
  obra_id: '', apto: '', contrato_id: '',
  soporte_tipo: '', soporte_ref: '', fecha_aprobacion: '',
  acta_id: '', cobro_ref: '', fecha_cobro: '', notas: '',
  gestion_ref: null, instalador: '', responsable: 'obra', memorando: '',
}

export default function Adicionales({ dbData, setDbData, toast, nav, irA, puedeEditar, verValorContrato = true }) {
  const editable = puedeEditar ? puedeEditar('adicionales') : true
  const {
    proyectos = [], constructoras = [], contratos = [], adicionales = [],
    actas_facturacion = [], obras = [], usuarios = [],
  } = dbData

  const navProy = nav?.proyectoId ? proyectos.find(p => p.id === nav.proyectoId) : null
  const [proySel, setProySel] = useState(navProy)
  const [tab, setTab]         = useState('obra')        // obra | instalador | gestion
  const [modal, setModal]     = useState(false)
  const [form, setForm]       = useState(vacio)
  const [editId, setEditId]   = useState(null)
  const [saving, setSaving]   = useState(false)
  const [filtEstado, setFiltEstado] = useState('')

  // ── Torres del proyecto ───────────────────────────────────
  const torresDe = proy => [...new Set([...(proy?.obras_ids || []), proy?.obra_id].filter(Boolean))]
    .map(id => obras.find(o => o.id === id)).filter(Boolean)
  const nombreTorre = id => obras.find(o => o.id === id)?.nombre || ''

  const adDe = proyId => adicionales.filter(a => a.proyecto_id === proyId)
  const valorCobro = a => Number(a.valor_cobro || 0) * Number(a.cantidad || 1)
  const valorCosto = a => Number(a.valor || 0) * Number(a.cantidad || 1)

  // ── Adicionales marcados en Gestión de Obras (se le pagan al instalador) ──
  function adicionalesGestion(proy) {
    const out = []
    for (const t of torresDe(proy)) {
      for (const p of t.pisos || []) for (const a of p.aptos || []) {
        const lista = [...(a.elementos || []), ...(a.elementosExtra || [])]
        lista.forEach((el, i) => {
          if (!el.esAdicional) return
          const ref = `${t.id}|${a.id}|${el.descripcion || ''}|${el.fecha || ''}|${i}`
          out.push({
            ref, torreId: t.id, torre: t.nombre, apto: a.nombre || a.numero,
            descripcion: el.descripcion || 'Adicional', cantidad: Number(el.cantidad || 1),
            valor: Number(el.valorUnitario || 0), fecha: el.fecha || '',
            completado: !!el.completado, responsable: el.responsable || null, memorando: el.memorando || null,
            instalador: usuarios.find(u => u.id === el.instaladorId)?.nombre || '',
          })
        })
      }
    }
    return out
  }

  // Cada adicional de Gestión se combina con su registro en el ERP (si lo tiene):
  // el ERP guarda el valor de cobro, el estado del cobro, el acta y, si hace falta, la clasificación.
  const COBRO_X = 2   // por defecto se le cobra a la obra el doble de lo pagado al instalador
  function unificados(proy) {
    const regs = adDe(proy.id)
    const deGestion = adicionalesGestion(proy).map(g => {
      const r = regs.find(x => x.gestion_ref === g.ref)
      const resp = r?.responsable || g.responsable || null
      return {
        key: g.ref, g, r,
        responsable: resp,
        fecha: g.fecha, torreId: g.torreId, torre: g.torre, apto: g.apto, descripcion: g.descripcion,
        instalador: g.instalador, cantidad: g.cantidad,
        pagado: g.valor * g.cantidad,
        cobro: r && Number(r.valor_cobro) > 0 ? Number(r.valor_cobro) * Number(r.cantidad || 1) : g.valor * g.cantidad * COBRO_X,
        memorando: g.memorando || r?.memorando || null,
        estado: r?.estado || 'pendiente', completado: g.completado,
        acta_id: r?.acta_id || null, cobro_ref: r?.cobro_ref || null,
      }
    })
    const manuales = regs.filter(r => !r.gestion_ref).map(r => ({
      key: r.id, g: null, r, responsable: r.responsable || 'obra',
      fecha: r.fecha, torreId: r.obra_id, torre: nombreTorre(r.obra_id), apto: r.apto, descripcion: r.descripcion,
      instalador: r.instalador, cantidad: Number(r.cantidad || 1),
      pagado: valorCosto(r), cobro: valorCobro(r), memorando: r.memorando || r.soporte_ref || null,
      estado: r.estado || 'pendiente', completado: true, acta_id: r.acta_id, cobro_ref: r.cobro_ref,
    }))
    return [...deGestion, ...manuales]
  }

  // Guarda (o crea) el registro del ERP de un adicional que viene de Gestión
  async function guardarRegistro(u, cambios) {
    try {
      if (u.r) {
        const { data, error } = await supabase.from('adicionales').update(cambios).eq('id', u.r.id).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, adicionales: d.adicionales.map(a => a.id === data.id ? data : a) }))
      } else {
        const fila = {
          proyecto_id: proySel.id, origen: 'instalador', gestion_ref: u.g.ref,
          descripcion: u.descripcion, cantidad: u.cantidad, unidad: 'und',
          valor: u.g.valor, valor_cobro: u.g.valor * COBRO_X,
          obra_id: u.torreId, apto: String(u.apto || ''), instalador: u.instalador || null,
          fecha: null, estado: 'pendiente', responsable: u.responsable, memorando: u.memorando,
          cobrar_a_obra: u.responsable === 'obra', ...cambios,
        }
        const { data, error } = await supabase.from('adicionales').insert(fila).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, adicionales: [...(d.adicionales || []), data] }))
      }
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  // ── Guardar ───────────────────────────────────────────────
  function abrirNuevo(base = {}) {
    setEditId(null)
    setForm({ ...vacio, fecha: new Date().toISOString().slice(0, 10),
      obra_id: torresDe(proySel).length === 1 ? torresDe(proySel)[0].id : '', ...base })
    setModal(true)
  }
  function abrirEditar(a) {
    setEditId(a.id)
    const f = { ...vacio }
    for (const k of Object.keys(vacio)) f[k] = a[k] ?? vacio[k]
    setForm(f)
    setModal(true)
  }

  async function guardar() {
    if (!String(form.descripcion || '').trim()) { toast('Escribe la descripción', 'err'); return }
    setSaving(true)
    try {
      const hoy = new Date().toISOString().slice(0, 10)
      const fila = {
        proyecto_id: proySel.id,
        origen: form.origen, descripcion: String(form.descripcion).trim(), unidad: form.unidad || 'und',
        cantidad: Number(form.cantidad) || 1,
        valor_cobro: Number(form.valor_cobro) || 0, valor: Number(form.valor) || 0,
        estado: form.estado,
        aprobado: ['aprobado', 'ejecutado', 'cobrado'].includes(form.estado),
        cobrar_a_obra: form.origen === 'obra' || Number(form.valor_cobro) > 0,
        fecha: form.fecha || null,
        obra_id: form.obra_id || null, apto: form.apto || null, contrato_id: form.contrato_id || null,
        soporte_tipo: form.soporte_tipo || null, soporte_ref: form.soporte_ref || null,
        fecha_aprobacion: form.fecha_aprobacion || null,
        acta_id: form.acta_id || null, cobro_ref: form.cobro_ref || null, fecha_cobro: form.fecha_cobro || null,
        notas: form.notas || null, gestion_ref: form.gestion_ref || null, instalador: form.instalador || null,
        responsable: form.responsable || 'obra', memorando: form.memorando || null,
      }
      if (fila.estado === 'cobrado' && !fila.fecha_cobro) fila.fecha_cobro = hoy
      if (fila.aprobado && !fila.fecha_aprobacion) fila.fecha_aprobacion = hoy

      if (editId) {
        const { data, error } = await supabase.from('adicionales').update(fila).eq('id', editId).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, adicionales: d.adicionales.map(a => a.id === editId ? data : a) }))
      } else {
        const { data, error } = await supabase.from('adicionales').insert(fila).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, adicionales: [...(d.adicionales || []), data] }))
      }
      toast('Adicional guardado', 'ok')
      setModal(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
  }

  async function cambiarEstado(a, estado) {
    const hoy = new Date().toISOString().slice(0, 10)
    const cambios = { estado, aprobado: ['aprobado', 'ejecutado', 'cobrado'].includes(estado) }
    if (cambios.aprobado && !a.fecha_aprobacion) cambios.fecha_aprobacion = hoy
    if (estado === 'cobrado' && !a.fecha_cobro) cambios.fecha_cobro = hoy
    const { data, error } = await supabase.from('adicionales').update(cambios).eq('id', a.id).select().single()
    if (error) { toast('Error: ' + error.message, 'err'); return }
    setDbData(d => ({ ...d, adicionales: d.adicionales.map(x => x.id === a.id ? data : x) }))
  }

  async function eliminar(a) {
    if (!window.confirm(`¿Eliminar el adicional "${a.descripcion}"?`)) return
    const { error } = await supabase.from('adicionales').delete().eq('id', a.id)
    if (error) { toast('Error: ' + error.message, 'err'); return }
    setDbData(d => ({ ...d, adicionales: d.adicionales.filter(x => x.id !== a.id) }))
    toast('Adicional eliminado', 'ok')
  }

  // ── Vista lista de proyectos ──────────────────────────────
  if (!proySel) {
    const proys = [...proyectos].sort((a, b) => a.nombre.localeCompare(b.nombre))
    return (
      <div>
        <SectionHeader title="➕ Adicionales" />
        <div style={{ display: 'grid', gap: 8 }}>
          {proys.map(p => {
            const us = unificados(p)
            const ads = us
            const porCobrar = us.filter(u => u.responsable === 'obra' && !['cobrado', 'rechazado'].includes(u.estado)).reduce((s, u) => s + u.cobro, 0)
            const pend = us.filter(u => u.responsable === 'obra' && !u.memorando).length
            const gest = us.filter(u => !u.responsable).length
            return (
              <div key={p.id} style={{ ...card, padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
                onClick={() => { setProySel(p); setTab('obra') }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{p.nombre}</div>
                  <div style={{ fontSize: 12, color: C.g5 }}>
                    {constructoras.find(c => c.id === p.constructora_id)?.nombre || '—'} · {ads.length} adicional(es)
                    {gest ? ` · ${gest} sin clasificar` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {pend > 0 && <Badge color="red">{pend} sin memorando</Badge>}
                  {verValorContrato && porCobrar > 0 && <Badge color="orange">{fmt(porCobrar)} por cobrar</Badge>}
                </div>
              </div>
            )
          })}
          {proys.length === 0 && <Empty icon="➕" title="Sin proyectos" desc="Crea un proyecto para registrar adicionales." />}
        </div>
      </div>
    )
  }

  // ── Vista del proyecto ────────────────────────────────────
  const torres   = torresDe(proySel)
  const actasP   = actas_facturacion.filter(a => contratos.some(c => c.id === a.contrato_id && c.proyecto_id === proySel.id))
  const todos    = unificados(proySel)
  const deObra   = todos.filter(u => u.responsable === 'obra')
  const deSL     = todos.filter(u => u.responsable === 'santalucia')
  const sinClas  = todos.filter(u => !u.responsable)

  const cobrables  = deObra.filter(u => u.estado !== 'rechazado')
  const porCobrar  = cobrables.filter(u => u.estado !== 'cobrado').reduce((s, u) => s + u.cobro, 0)
  const cobrado    = cobrables.filter(u => u.estado === 'cobrado').reduce((s, u) => s + u.cobro, 0)
  const asumido    = deSL.reduce((s, u) => s + u.pagado, 0)
  const pagadoObra = cobrables.reduce((s, u) => s + u.pagado, 0)
  const sinMemo    = deObra.filter(u => !u.memorando).length

  const lista = (tab === 'obra' ? deObra : tab === 'santalucia' ? deSL : sinClas)
    .filter(u => !filtEstado || u.estado === filtEstado)
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))

  const tabBtn = (k, label) => (
    <button onClick={() => { setTab(k); setFiltEstado('') }} style={{
      padding: '8px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
      fontWeight: tab === k ? 700 : 500, background: tab === k ? C.bk : 'transparent', color: tab === k ? C.wh : C.g5,
    }}>{label}</button>
  )
  const lugar = u => [torres.length > 1 && u.torre ? u.torre : null, u.apto ? `Apto ${u.apto}` : null].filter(Boolean).join(' · ') || '—'

  // Cambiar algo de un adicional (de Gestión o manual)
  const cambiar = (u, cambios) => u.g ? guardarRegistro(u, cambios)
    : supabase.from('adicionales').update(cambios).eq('id', u.r.id).select().single().then(({ data, error }) => {
        if (error) { toast('Error: ' + error.message, 'err'); return }
        setDbData(d => ({ ...d, adicionales: d.adicionales.map(x => x.id === data.id ? data : x) }))
      })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Btn onClick={() => setProySel(null)}>← Adicionales</Btn>
        {nav?.desde === 'proyecto' && irA && <Btn variant="primary" onClick={() => irA('proyectos', { proyectoId: nav.proyectoId })}>← Volver al proyecto</Btn>}
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>➕ Adicionales — {proySel.nombre}</h1>
        {editable && <div style={{ marginLeft: 'auto' }}>
          <Btn onClick={() => abrirNuevo({ origen: 'obra' })}>+ Adicional por fuera de Gestión</Btn>
        </div>}
      </div>

      {verValorContrato && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
          <Stat label="Por cobrar a obra" value={fmt(porCobrar)} color={C.or} sub={`${cobrables.filter(u => u.estado !== 'cobrado').length} adicional(es)`} />
          <Stat label="Cobrado" value={fmt(cobrado)} color={C.gnD} />
          <Stat label="Margen de lo cobrable" value={fmt(porCobrar + cobrado - pagadoObra)} sub={`pagado al instalador ${fmt(pagadoObra)}`} />
          <Stat label="Asumido por Santa Lucía" value={fmt(asumido)} color={C.rd} sub={`${deSL.length} adicional(es) · costo de la obra`} />
        </div>
      )}

      {sinMemo > 0 && (
        <div style={{ ...card, borderLeft: `4px solid ${C.rd}`, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          ⛔ Hay <strong>{sinMemo}</strong> adicional(es) de la obra sin memorando. No se le pagan al instalador hasta que lo tengan en Gestión de Obras.
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: C.g1, padding: 4, borderRadius: 10 }}>
          {tabBtn('obra', `🏗️ Cobrar a obra (${deObra.length})`)}
          {tabBtn('santalucia', `🪵 Asumidos Santa Lucía (${deSL.length})`)}
          {tabBtn('sin', `⚠️ Sin clasificar (${sinClas.length})`)}
        </div>
        {tab === 'obra' && (
          <select value={filtEstado} onChange={e => setFiltEstado(e.target.value)}
            style={{ padding: '7px 10px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 13 }}>
            <option value="">Todos los estados</option>
            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        )}
      </div>

      {lista.length === 0 ? (
        <Empty icon="➕" title="Nada por acá"
          desc={tab === 'obra' ? 'Los adicionales que en Gestión se marquen como "De la obra" aparecen acá para cobrarlos.'
            : tab === 'santalucia' ? 'Los adicionales que asumimos nosotros aparecen acá.'
            : 'Todos los adicionales están clasificados.'} />
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#1E3A5F' }}>
                {['FECHA', 'UBICACIÓN', 'DESCRIPCIÓN', 'INSTALADOR', 'CANT.',
                  ...(verValorContrato ? ['PAGADO'] : []),
                  ...(tab === 'obra' ? ['MEMO', ...(verValorContrato ? ['COBRO'] : []), 'ESTADO', 'ACTA / FACTURA'] : []),
                  ...(tab === 'sin' ? ['CLASIFICAR'] : []), ''].map((h, i) => (
                  <th key={h + i} style={{ padding: '8px 10px', textAlign: ['CANT.', 'PAGADO', 'COBRO'].includes(h) ? 'right' : 'left', color: '#BFDBFE', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map(u => (
                <tr key={u.key} style={{ borderTop: `1px solid ${C.g1}`, opacity: u.estado === 'rechazado' ? .5 : 1 }}>
                  <td style={{ padding: '7px 10px', color: C.g5, whiteSpace: 'nowrap' }}>{u.fecha || '—'}</td>
                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{lugar(u)}</td>
                  <td style={{ padding: '7px 10px', fontWeight: 600 }}>
                    {u.descripcion}
                    {!u.completado && <span style={{ fontSize: 10, color: C.g4, marginLeft: 6, fontWeight: 400 }}>sin instalar</span>}
                    {!u.g && <span style={{ fontSize: 10, color: C.bl, marginLeft: 6, fontWeight: 400 }}>manual</span>}
                  </td>
                  <td style={{ padding: '7px 10px', color: C.g5 }}>{u.instalador || '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right' }}>{u.cantidad}</td>
                  {verValorContrato && <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmt(u.pagado)}</td>}

                  {tab === 'obra' && <>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                      {u.memorando ? <span style={{ fontWeight: 600 }}>{u.memorando}</span>
                        : <span style={{ color: C.rd, fontWeight: 700 }}>⛔ falta</span>}
                    </td>
                    {verValorContrato && <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                      {editable ? (
                        <input type="number" min="0" key={u.cobro} defaultValue={Math.round(u.cobro)}
                          title="Valor total a cobrar. Por defecto el doble de lo pagado al instalador."
                          onBlur={e => { const v = Number(e.target.value) || 0; if (v !== Math.round(u.cobro)) cambiar(u, { valor_cobro: u.cantidad ? v / u.cantidad : v }) }}
                          style={{ width: 100, padding: '4px 6px', border: `1px solid ${C.g2}`, borderRadius: 6, textAlign: 'right', fontSize: 12, fontWeight: 700 }} />
                      ) : <strong>{fmt(u.cobro)}</strong>}
                    </td>}
                    <td style={{ padding: '4px 8px' }}>
                      {editable ? (
                        <select value={u.estado} onChange={e => {
                          const est = e.target.value, hoy = new Date().toISOString().slice(0, 10)
                          cambiar(u, { estado: est, aprobado: ['aprobado', 'ejecutado', 'cobrado'].includes(est), ...(est === 'cobrado' ? { fecha_cobro: hoy } : {}) })
                        }} style={{ padding: '4px 6px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12 }}>
                          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      ) : <Badge color={(ESTADOS[u.estado] || ESTADOS.pendiente).color}>{(ESTADOS[u.estado] || ESTADOS.pendiente).label}</Badge>}
                    </td>
                    <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                      {editable ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <select value={u.acta_id || ''} onChange={e => cambiar(u, { acta_id: e.target.value || null })}
                            style={{ padding: '4px 6px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12, maxWidth: 110 }}>
                            <option value="">Sin acta</option>
                            {actasP.map(a => <option key={a.id} value={a.id}>Acta {a.numero_acta || '—'}</option>)}
                          </select>
                          <input key={u.cobro_ref || ''} defaultValue={u.cobro_ref || ''} placeholder="Factura"
                            onBlur={e => { const v = e.target.value.trim(); if (v !== (u.cobro_ref || '')) cambiar(u, { cobro_ref: v || null }) }}
                            style={{ width: 80, padding: '4px 6px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12 }} />
                        </div>
                      ) : (actasP.find(a => a.id === u.acta_id) ? `Acta ${actasP.find(a => a.id === u.acta_id).numero_acta}` : u.cobro_ref || '—')}
                    </td>
                  </>}

                  {tab === 'sin' && (
                    <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                      {editable && <>
                        <Btn size="sm" onClick={() => cambiar(u, { responsable: 'obra', cobrar_a_obra: true })}>🏗️ Obra</Btn>{' '}
                        <Btn size="sm" onClick={() => cambiar(u, { responsable: 'santalucia', cobrar_a_obra: false })}>🪵 Santa Lucía</Btn>
                      </>}
                    </td>
                  )}

                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                    {editable && !u.g && u.r && <>
                      <Btn size="sm" onClick={() => abrirEditar(u.r)}>Editar</Btn>
                      <span onClick={() => eliminar(u.r)} title="Eliminar" style={{ cursor: 'pointer', color: C.rd, fontWeight: 700, marginLeft: 8 }}>✕</span>
                    </>}
                    {editable && u.g && tab !== 'sin' && (
                      <span title="Cambiar de lista" onClick={() => cambiar(u, { responsable: u.responsable === 'obra' ? 'santalucia' : 'obra', cobrar_a_obra: u.responsable !== 'obra' })}
                        style={{ cursor: 'pointer', fontSize: 11, color: C.g4 }}>⇄ {u.responsable === 'obra' ? 'pasar a Santa Lucía' : 'pasar a obra'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 12, color: C.g5, marginTop: 10 }}>
        Los adicionales se registran en Gestión de Obras, en el apartamento, eligiendo si son de la obra o de Santa Lucía.
        A la obra se le cobra por defecto el doble de lo pagado al instalador (se puede cambiar en la casilla de cobro).
        Lo asumido por Santa Lucía suma al costo de la obra.
      </p>

      {/* ── Formulario ── */}
      {modal && (
        <Modal title={editId ? 'Editar adicional' : 'Nuevo adicional'} onClose={() => setModal(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Inp label="Descripción *" value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Ej: Puerta adicional cuarto útil piso 12" />
            </div>
            <Sel label="De quién es" value={form.responsable || 'obra'} onChange={e => setForm(f => ({ ...f, responsable: e.target.value }))}>
              <option value="obra">🏗️ De la obra (se cobra)</option>
              <option value="santalucia">🪵 Santa Lucía (lo asumimos)</option>
            </Sel>
            <Inp label="Cantidad" type="number" min="0" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))} />
            <Inp label="Unidad" value={form.unidad} onChange={e => setForm(f => ({ ...f, unidad: e.target.value }))} />
            {verValorContrato && <Inp label="Valor unitario a cobrar" type="number" min="0" value={form.valor_cobro}
              onChange={e => setForm(f => ({ ...f, valor_cobro: e.target.value }))} hint="Lo que se le cobra a la constructora" />}
            {verValorContrato && <Inp label="Costo unitario" type="number" min="0" value={form.valor}
              onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} hint="Lo que cuesta (material, instalador)" />}
            <Inp label="Fecha" type="date" value={form.fecha || ''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            {torres.length > 1 && (
              <Sel label="Torre" value={form.obra_id || ''} onChange={e => setForm(f => ({ ...f, obra_id: e.target.value }))}>
                <option value="">— Sin torre —</option>
                {torres.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </Sel>
            )}
            <Inp label="Apto / ubicación" value={form.apto || ''} onChange={e => setForm(f => ({ ...f, apto: e.target.value }))} placeholder="Opcional" />
            {(form.responsable || 'obra') === 'obra' && <Inp label="N° memorando" value={form.memorando || ''} onChange={e => setForm(f => ({ ...f, memorando: e.target.value }))} />}
            <Sel label="Estado" value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
              {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Sel>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: C.g5, margin: '6px 0 8px', borderTop: `1px solid ${C.g2}`, paddingTop: 10 }}>APROBACIÓN</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' }}>
            <Sel label="Cómo se aprobó" value={form.soporte_tipo || ''} onChange={e => setForm(f => ({ ...f, soporte_tipo: e.target.value }))}>
              <option value="">— Sin aprobar —</option>
              {Object.entries(SOPORTES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Sel>
            <Inp label="Referencia" value={form.soporte_ref || ''} onChange={e => setForm(f => ({ ...f, soporte_ref: e.target.value }))} placeholder="N° de orden, asunto del correo…" />
            <Inp label="Fecha de aprobación" type="date" value={form.fecha_aprobacion || ''} onChange={e => setForm(f => ({ ...f, fecha_aprobacion: e.target.value }))} />
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: C.g5, margin: '6px 0 8px', borderTop: `1px solid ${C.g2}`, paddingTop: 10 }}>COBRO</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' }}>
            <Sel label="Dentro de un acta" value={form.acta_id || ''} onChange={e => setForm(f => ({ ...f, acta_id: e.target.value }))}>
              <option value="">— No / aparte —</option>
              {actasP.map(a => <option key={a.id} value={a.id}>Acta {a.numero_acta || '—'}{a.fecha ? ` · ${a.fecha}` : ''}</option>)}
            </Sel>
            <Inp label="Factura aparte" value={form.cobro_ref || ''} onChange={e => setForm(f => ({ ...f, cobro_ref: e.target.value }))} placeholder="N° de factura" />
            <Inp label="Fecha de cobro" type="date" value={form.fecha_cobro || ''} onChange={e => setForm(f => ({ ...f, fecha_cobro: e.target.value }))} />
          </div>

          <Txt label="Notas" value={form.notas || ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
          {verValorContrato && (
            <div style={{ fontSize: 13, color: C.g5, marginBottom: 12 }}>
              Cobro: <strong>{fmt((Number(form.valor_cobro) || 0) * (Number(form.cantidad) || 1))}</strong> ·
              Costo: <strong>{fmt((Number(form.valor) || 0) * (Number(form.cantidad) || 1))}</strong>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Btn onClick={() => setModal(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
