import { useState } from 'react'
import { C, Btn, Inp, Sel, Txt, Modal, Badge, Empty, SectionHeader, card, fmt, fmtDate, Progress } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

const ESTADOS_REM = {
  completa:  { label: 'Completa',  color: 'green' },
  parcial:   { label: 'Parcial',   color: 'amber' },
}

export default function Despachos({ dbData, setDbData, toast, user }) {
  const {
    proyectos = [], constructoras = [], contratos = [],
    items_contrato = [], remisiones = [], items_remision = [],
    items_control_despacho = [], actas_facturacion = [],
    items_acta_facturacion = [],
  } = dbData

  const [vista, setVista]             = useState('lista')       // lista | proyecto | remision
  const [proySel, setProySel]         = useState(null)
  const [contratoSel, setContratoSel] = useState(null)
  const [remSel, setRemSel]           = useState(null)
  const [modalRem, setModalRem]       = useState(false)
  const [modalControl, setModalControl] = useState(false)
  const [formRem, setFormRem]         = useState({ numero: '', fecha: '', transportador: '', notas: '' })
  const [editRemId, setEditRemId]     = useState(null)
  const [cantidades, setCantidades]   = useState({})   // { item_contrato_id: cantidad }
  const [itemsControl, setItemsControl] = useState([{ descripcion: '', unidad: 'und', cantidad: '' }])
  const [saving, setSaving]           = useState(false)
  const [filtProy, setFiltProy]       = useState('')

  // ── Helpers ───────────────────────────────────────────────
  const proyectoName = id => proyectos.find(p => p.id === id)?.nombre || '—'

  // Cantidad total despachada de un ítem del contrato
  const cantDespachada = (itemContratoId) =>
    items_remision
      .filter(i => i.item_contrato_id === itemContratoId)
      .reduce((s, i) => s + Number(i.cantidad || 0), 0)

  // Cantidad facturada de un ítem del contrato
  const cantFacturada = (itemContratoId) =>
    items_acta_facturacion
      .filter(i => i.item_contrato_id === itemContratoId)
      .reduce((s, i) => s + Number(i.cantidad || 0), 0)

  // Contratos de suministro de un proyecto
  const contratosSum = (proyId) =>
    contratos.filter(c => c.proyecto_id === proyId && (c.tipo === 'suministro' || c.tipo === 'todo_costo'))

  // Remisiones de un contrato
  const remisContrato = (contratoId) =>
    remisiones.filter(r => r.contrato_id === contratoId)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))

  // % despachado de un contrato
  const pctDespachado = (contratoId) => {
    const items = items_contrato.filter(i => i.contrato_id === contratoId)
    if (!items.length) return 0
    const totalContr = items.reduce((s, i) => s + Number(i.cantidad || 0), 0)
    const totalDesp  = items.reduce((s, i) => s + cantDespachada(i.id), 0)
    return totalContr > 0 ? (totalDesp / totalContr) * 100 : 0
  }

  // ── Exportar Excel pendiente por facturar ───────────────────
  async function exportarPendiente(contrato) {
    const itsContr = items_contrato.filter(i => i.contrato_id === contrato.id)
    const constr   = constructoras.find(c => c.id === proySel.constructora_id)
    const pendientes = itsContr.map(it => {
      const contratado = Number(it.cantidad || 0)
      const despachado = cantDespachada(it.id)
      const facturado  = cantFacturada(it.id)
      const xFact      = Math.max(0, despachado - facturado)
      const vrUnit     = Number(it.vr_unitario || 0)
      return { ...it, contratado, despachado, facturado, xFact, vrUnit, totalFact: xFact * vrUnit }
    }).filter(it => it.xFact > 0)

    if (!pendientes.length) {
      toast('No hay ítems pendientes por facturar', 'info')
      return
    }

    // Llamar a la API del servidor para generar Excel
    const payload = {
      proyecto: proySel.nombre,
      constructora: constr?.nombre || '—',
      contrato: contrato.numero || '—',
      tipo: contrato.tipo,
      fecha: new Date().toLocaleDateString('es-CO'),
      items: pendientes,
    }

    try {
      const resp = await fetch('/api/generar-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) throw new Error('Error generando Excel')
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `PENDIENTE_${proySel.nombre}_${contrato.tipo}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast('Excel generado correctamente', 'ok')
    } catch {
      toast('Generando Excel localmente…', 'info')
      // Fallback: CSV simple
      const csv = [
        `INFORME DE COBRO - ${proySel.nombre}`,
        `Constructora: ${constr?.nombre || '—'}`,
        `Contrato: ${contrato.numero || '—'} (${contrato.tipo})`,
        `Fecha: ${new Date().toLocaleDateString('es-CO')}`,
        '',
        'Ref,Descripción,UM,Despachado,Facturado,X Facturar,Vr. Unitario,Total',
        ...pendientes.map(it =>
          `${it.ref},"${it.descripcion}",${it.unidad},${it.despachado},${it.facturado},${it.xFact},${it.vrUnit},${it.totalFact}`
        ),
        '',
        `TOTAL A FACTURAR,,,,,,, ${pendientes.reduce((s,i) => s + i.totalFact, 0)}`,
      ].join('\n')
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `PENDIENTE_${proySel.nombre}.csv`; a.click()
      URL.revokeObjectURL(url)
    }
  }

  // ── Guardar remisión ──────────────────────────────────────
  async function guardarRemision() {
    if (!formRem.numero) { toast('Ingresa el número de remisión', 'err'); return }
    if (!formRem.fecha)  { toast('Ingresa la fecha', 'err'); return }
    const cantValidas = Object.entries(cantidades).filter(([, v]) => Number(v) > 0)
    if (!cantValidas.length) { toast('Ingresa al menos una cantidad', 'err'); return }
    setSaving(true)
    try {
      let remId = editRemId
      if (!editRemId) {
        const { data: rem, error: e1 } = await supabase.from('remisiones').insert({
          proyecto_id: proySel.id,
          contrato_id: contratoSel.id,
          numero: formRem.numero,
          fecha: formRem.fecha,
          transportador: formRem.transportador || null,
          notas: formRem.notas || null,
        }).select().single()
        if (e1) throw e1
        remId = rem.id
        setDbData(d => ({ ...d, remisiones: [...d.remisiones, rem] }))
      } else {
        const { data: rem, error: e1 } = await supabase.from('remisiones')
          .update({ numero: formRem.numero, fecha: formRem.fecha, transportador: formRem.transportador || null, notas: formRem.notas || null })
          .eq('id', editRemId).select().single()
        if (e1) throw e1
        setDbData(d => ({ ...d, remisiones: d.remisiones.map(r => r.id === editRemId ? rem : r) }))
        // Eliminar ítems anteriores
        await supabase.from('items_remision').delete().eq('remision_id', editRemId)
        setDbData(d => ({ ...d, items_remision: d.items_remision.filter(i => i.remision_id !== editRemId) }))
      }
      // Guardar ítems
      const rows = cantValidas.map(([itemId, cant]) => ({
        remision_id: remId,
        item_contrato_id: itemId,
        cantidad: Number(cant),
      }))
      const { data: its, error: e2 } = await supabase.from('items_remision').insert(rows).select()
      if (e2) throw e2
      setDbData(d => ({ ...d, items_remision: [...d.items_remision, ...its] }))
      // Alertas por sobrepasar cantidad contratada
      const alertas = []
      cantValidas.forEach(([itemId, cant]) => {
        const ic = items_contrato.find(i => i.id === itemId)
        if (!ic) return
        const yaDesp = cantDespachada(itemId)
        const nuevaDesp = yaDesp + Number(cant)
        if (nuevaDesp > Number(ic.cantidad || 0)) {
          alertas.push(`⚠️ ${ic.ref}: despachado ${nuevaDesp.toLocaleString('es-CO')} supera contrato ${Number(ic.cantidad).toLocaleString('es-CO')}`)
        }
      })
      if (alertas.length) {
        setTimeout(() => alertas.forEach(a => toast(a, 'err')), 500)
      }
      toast(`Remisión ${formRem.numero} guardada`, 'ok')
      setModalRem(false); setCantidades({}); setEditRemId(null)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
  }

  async function eliminarRemision(remId) {
    try {
      await supabase.from('items_control_despacho').delete().eq('remision_id', remId)
      await supabase.from('items_remision').delete().eq('remision_id', remId)
      await supabase.from('remisiones').delete().eq('id', remId)
      setDbData(d => ({
        ...d,
        remisiones: d.remisiones.filter(r => r.id !== remId),
        items_remision: d.items_remision.filter(i => i.remision_id !== remId),
        items_control_despacho: d.items_control_despacho.filter(i => i.remision_id !== remId),
      }))
      toast('Remisión eliminada', 'ok')
      if (remSel?.id === remId) setRemSel(null)
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  // ── Guardar ítems de control ──────────────────────────────
  async function guardarControl() {
    if (!remSel) return
    const validos = itemsControl.filter(i => i.descripcion && Number(i.cantidad) > 0)
    if (!validos.length) { toast('Agrega al menos un ítem', 'err'); return }
    setSaving(true)
    try {
      const rows = validos.map(i => ({
        remision_id: remSel.id,
        descripcion: i.descripcion,
        unidad: i.unidad || 'und',
        cantidad: Number(i.cantidad),
        notas: i.notas || null,
      }))
      const { data, error } = await supabase.from('items_control_despacho').insert(rows).select()
      if (error) throw error
      setDbData(d => ({ ...d, items_control_despacho: [...d.items_control_despacho, ...data] }))
      toast('Ítems de control guardados', 'ok'); setModalControl(false)
      setItemsControl([{ descripcion: '', unidad: 'und', cantidad: '' }])
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
  }

  function abrirNuevaRemision(contrato) {
    setContratoSel(contrato)
    setFormRem({ numero: '', fecha: '', transportador: '', notas: '' })
    setEditRemId(null)
    // Pre-cargar ítems del contrato con cantidad 0
    const its = items_contrato.filter(i => i.contrato_id === contrato.id)
    const cants = {}
    its.forEach(i => { cants[i.id] = '' })
    setCantidades(cants)
    setModalRem(true)
  }

  function abrirEditarRemision(rem) {
    setFormRem({ numero: rem.numero, fecha: rem.fecha, transportador: rem.transportador || '', notas: rem.notas || '' })
    setEditRemId(rem.id)
    const its = items_remision.filter(i => i.remision_id === rem.id)
    const cants = {}
    items_contrato.filter(i => i.contrato_id === rem.contrato_id).forEach(i => {
      const found = its.find(x => x.item_contrato_id === i.id)
      cants[i.id] = found ? String(found.cantidad) : ''
    })
    setCantidades(cants)
    setContratoSel(contratos.find(c => c.id === rem.contrato_id))
    setModalRem(true)
  }

  // ── Vista por proyecto ────────────────────────────────────
  const renderProyecto = () => {
    const contrSel = contratosSum(proySel.id)
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <Btn onClick={() => { setVista('lista'); setProySel(null) }}>← Proyectos</Btn>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>📦 Despachos — {proySel.nombre}</h1>
        </div>

        {contrSel.length === 0 ? (
          <Empty icon="📄" title="Sin contratos de suministro" desc="Este proyecto no tiene contratos de suministro o todo costo." />
        ) : (
          contrSel.map(contrato => {
            const itsContr  = items_contrato.filter(i => i.contrato_id === contrato.id)
            const remisContr = remisContrato(contrato.id)
            const pct = pctDespachado(contrato.id)
            const tipoLabel = contrato.tipo === 'suministro' ? '📦 Suministro' : '📋 Todo Costo'

            return (
              <div key={contrato.id} style={{ marginBottom: 32 }}>
                {/* Header contrato */}
                <div style={{ ...card, padding: '14px 18px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `3px solid ${C.bl}` }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{tipoLabel} {contrato.numero ? `#${contrato.numero}` : ''}</div>
                    <div style={{ fontSize: 13, color: C.g5, marginTop: 4 }}>
                      {fmt(contrato.valor_total)} · {itsContr.length} ítems · {remisContr.length} remisión(es)
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ width: 140 }}><Progress value={pct} /></div>
                    <span style={{ fontSize: 12, color: C.g5 }}>{Math.round(pct)}% despachado</span>
                    {(() => {
                      const xFact = itsContr.reduce((s, it) => s + Math.max(0, cantDespachada(it.id) - cantFacturada(it.id)), 0)
                      const vrXFact = itsContr.reduce((s, it) => s + Math.max(0, cantDespachada(it.id) - cantFacturada(it.id)) * Number(it.vr_unitario||0), 0)
                      return xFact > 0 ? (
                        <div style={{ background: '#FFF7ED', border: `1px solid #FED7AA`, borderRadius: 8, padding: '6px 12px', fontSize: 12 }}>
                          <span style={{ color: C.orD, fontWeight: 700 }}>⚡ {xFact.toLocaleString('es-CO')} und por facturar</span>
                          {vrXFact > 0 && <span style={{ color: C.or, marginLeft: 8 }}>{fmt(vrXFact)}</span>}
                        </div>
                      ) : null
                    })()}
                    <Btn onClick={() => exportarPendiente(contrato)}>📊 Exportar cobro</Btn>
                    <Btn variant="primary" onClick={() => abrirNuevaRemision(contrato)}>+ Nueva remisión</Btn>
                  </div>
                </div>

                {/* Cuadro de control — ítems del contrato */}
                <div style={{ ...card, padding: 0, overflow: 'auto', marginBottom: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 600 }}>
                    <thead>
                      <tr style={{ background: C.g0 }}>
                        <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.g5, borderBottom: `2px solid ${C.g2}`, width: 90 }}>REF</th>
                        <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.g5, borderBottom: `2px solid ${C.g2}` }}>DESCRIPCIÓN</th>
                        <th style={{ padding: '9px 12px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.g5, borderBottom: `2px solid ${C.g2}`, width: 60 }}>UM</th>
                        <th style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.g5, borderBottom: `2px solid ${C.g2}`, width: 90 }}>CONTRATO</th>
                        <th style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.gnD, borderBottom: `2px solid ${C.g2}`, width: 90 }}>DESPACHADO</th>
                        <th style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.bl, borderBottom: `2px solid ${C.g2}`, width: 90 }}>FACTURADO</th>
                        <th style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.or, borderBottom: `2px solid ${C.g2}`, width: 90 }}>X FACTURAR</th>
                        <th style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.am, borderBottom: `2px solid ${C.g2}`, width: 90 }}>FALTANTE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itsContr.map(it => {
                        const contratado = Number(it.cantidad || 0)
                        const despachado = cantDespachada(it.id)
                        const facturado  = cantFacturada(it.id)
                        const xFact      = Math.max(0, despachado - facturado)
                        const faltante   = Math.max(0, contratado - despachado)
                        const completo   = despachado >= contratado
                        return (
                          <tr key={it.id} style={{ borderBottom: `1px solid ${C.g1}`, background: completo ? '#F0FDF4' : '' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: C.or }}>{it.ref}</td>
                            <td style={{ padding: '8px 12px', maxWidth: 280 }}>{it.descripcion}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center', color: C.g5 }}>{it.unidad}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{contratado.toLocaleString('es-CO')}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: C.gnD }}>{despachado.toLocaleString('es-CO')}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: C.bl }}>{facturado.toLocaleString('es-CO')}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: xFact > 0 ? 700 : 400, color: xFact > 0 ? C.or : C.g4 }}>{xFact.toLocaleString('es-CO')}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: faltante > 0 ? C.am : C.gnD }}>{faltante.toLocaleString('es-CO')}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Lista de remisiones — tabla */}
                {remisContr.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                      Remisiones ({remisContr.length})
                    </div>
                    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: C.g0 }}>
                            {['Remisión','Fecha','Transportador','Ítems','Und. total','Control','Acciones'].map((h,i) => (
                              <th key={i} style={{ padding: '9px 12px', textAlign: i > 2 ? 'center' : 'left', fontSize: 11, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: `2px solid ${C.g2}`, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {remisContr.map(rem => {
                            const itsRem  = items_remision.filter(i => i.remision_id === rem.id)
                            const itsCtrl = items_control_despacho.filter(i => i.remision_id === rem.id)
                            const totalRem = itsRem.reduce((s, i) => s + Number(i.cantidad || 0), 0)
                            return (
                              <tr key={rem.id} style={{ borderBottom: `1px solid ${C.g1}` }}
                                onMouseEnter={e => e.currentTarget.style.background = C.g0}
                                onMouseLeave={e => e.currentTarget.style.background = ''}
                              >
                                <td style={{ padding: '10px 12px' }}>
                                  <span style={{ fontWeight: 700, color: C.or }}>REM {rem.numero}</span>
                                  {rem.notas && <div style={{ fontSize: 11, color: C.g4, marginTop: 2 }}>{rem.notas}</div>}
                                </td>
                                <td style={{ padding: '10px 12px', color: C.g5, whiteSpace: 'nowrap' }}>📅 {fmtDate(rem.fecha)}</td>
                                <td style={{ padding: '10px 12px', color: C.g5 }}>{rem.transportador || '—'}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                                    {itsRem.map(ir => {
                                      const ic = items_contrato.find(x => x.id === ir.item_contrato_id)
                                      return ic ? (
                                        <span key={ir.id} style={{ background: C.orL, border: `1px solid ${C.orM}`, borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600, color: C.orD }}>
                                          {ic.ref} {Number(ir.cantidad).toLocaleString('es-CO')}
                                        </span>
                                      ) : null
                                    })}
                                  </div>
                                </td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700 }}>{totalRem.toLocaleString('es-CO')}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                  {itsCtrl.length > 0 ? (
                                    <span style={{ background: C.amL, border: `1px solid #FDE68A`, borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#B45309' }}>
                                      {itsCtrl.length} ítem(s)
                                    </span>
                                  ) : <span style={{ color: C.g3 }}>—</span>}
                                </td>
                                <td style={{ padding: '10px 12px' }}>
                                  <div style={{ display: 'flex', gap: 5 }}>
                                    <Btn size="sm" onClick={() => { setRemSel(rem); setItemsControl([{ descripcion: '', unidad: 'und', cantidad: '' }]); setModalControl(true) }}>+ Control</Btn>
                                    <Btn size="sm" onClick={() => abrirEditarRemision(rem)}>Editar</Btn>
                                    <Btn size="sm" variant="danger" onClick={() => eliminarRemision(rem.id)}>Eliminar</Btn>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    )
  }

  // ── Vista lista de proyectos ──────────────────────────────
  const renderLista = () => {
    const proyConDespachos = proyectos.filter(p =>
      (!filtProy || p.id === filtProy) && contratosSum(p.id).length > 0
    )
    return (
      <div>
        <SectionHeader title="Despachos">
          <span style={{ fontSize: 13, color: C.g5 }}>Selecciona un proyecto para gestionar remisiones</span>
        </SectionHeader>

        <div style={{ marginBottom: 20 }}>
          <select value={filtProy} onChange={e => setFiltProy(e.target.value)}
            style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
            <option value="">Todos los proyectos</option>
            {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>

        {proyConDespachos.length === 0 ? (
          <Empty icon="🚚" title="Sin proyectos con contratos de suministro" desc="Crea primero un contrato de suministro en un proyecto." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px,1fr))', gap: 12 }}>
            {proyConDespachos.map(p => {
              const constrNombre = constructoras.find(c => c.id === p.constructora_id)?.nombre || '—'
              const contrsSum = contratosSum(p.id)
              const totalRems = remisiones.filter(r => r.proyecto_id === p.id).length
              const pctProm = contrsSum.reduce((s, c) => s + pctDespachado(c.id), 0) / (contrsSum.length || 1)
              return (
                <div key={p.id} style={{
                  ...card, cursor: 'pointer',
                  borderLeft: `4px solid ${C.bl}`,
                }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.1)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.06)'}
                  onClick={() => { setProySel(p); setVista('proyecto') }}
                >
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{p.nombre}</div>
                  <div style={{ fontSize: 12, color: C.g5, marginBottom: 10 }}>
                    🏢 {constrNombre} · {contrsSum.length} contrato(s) · {totalRems} remisión(es)
                  </div>
                  <Progress value={pctProm} />
                  <div style={{ fontSize: 11, color: C.g5, marginTop: 4 }}>{Math.round(pctProm)}% despachado</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Ítems del contrato para el modal de remisión ──────────
  const itsParaModal = contratoSel ? items_contrato.filter(i => i.contrato_id === contratoSel?.id) : []

  return (
    <div>
      {vista === 'lista'    && renderLista()}
      {vista === 'proyecto' && proySel && renderProyecto()}

      {/* Modal nueva/editar remisión */}
      {modalRem && contratoSel && (
        <Modal title={editRemId ? `Editar remisión ${formRem.numero}` : 'Nueva remisión'} onClose={() => { setModalRem(false); setCantidades({}); setEditRemId(null) }} wide fullscreen>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px', marginBottom: 16 }}>
            <Inp label="Número de remisión *" value={formRem.numero} onChange={e => setFormRem(f => ({ ...f, numero: e.target.value }))} placeholder="Ej: 13301" />
            <Inp label="Fecha *" type="date" value={formRem.fecha} onChange={e => setFormRem(f => ({ ...f, fecha: e.target.value }))} />
            <Inp label="Transportador" value={formRem.transportador || ''} onChange={e => setFormRem(f => ({ ...f, transportador: e.target.value }))} placeholder="Ej: Servientrega" />
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
            Cantidades despachadas en esta remisión
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto', border: `1px solid ${C.g2}`, borderRadius: 8, marginBottom: 16 }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead style={{ background: C.g0, position: 'sticky', top: 0 }}>
                <tr>
                  {['Ref','Descripción','UM','Contrato','Despachado','Faltante','Esta remisión'].map((h,i) => (
                    <th key={i} style={{ padding: '9px 10px', textAlign: i > 2 ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: C.g5, borderBottom: `2px solid ${C.g2}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itsParaModal.map(it => {
                  const contratado = Number(it.cantidad || 0)
                  const desp = cantDespachada(it.id)
                  const falt = Math.max(0, contratado - desp)
                  const val  = cantidades[it.id] || ''
                  const activo = Number(val) > 0
                  return (
                    <tr key={it.id} style={{ borderBottom: `1px solid ${C.g1}`, background: activo ? '#F0FDF4' : '' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 600, color: C.or, whiteSpace: 'nowrap' }}>{it.ref}</td>
                      <td style={{ padding: '7px 10px', maxWidth: 260, fontSize: 12 }}>{it.descripcion}</td>
                      <td style={{ padding: '7px 10px', color: C.g5, textAlign: 'right' }}>{it.unidad}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: C.g4 }}>{contratado.toLocaleString('es-CO')}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: C.gnD }}>{desp.toLocaleString('es-CO')}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: falt > 0 ? C.am : C.gnD }}>{falt.toLocaleString('es-CO')}</td>
                      <td style={{ padding: '7px 10px', width: 110 }}>
                        <input
                          type="number"
                          value={val}
                          onChange={e => setCantidades(c => ({ ...c, [it.id]: e.target.value }))}
                          placeholder="0"
                          style={{
                            width: '100%', padding: '5px 8px', textAlign: 'right',
                            border: `1px solid ${activo ? C.gnD : C.g2}`,
                            borderRadius: 6, fontSize: 13, outline: 'none',
                            background: activo ? '#F0FDF4' : C.wh,
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Txt label="Notas" value={formRem.notas || ''} onChange={e => setFormRem(f => ({ ...f, notas: e.target.value }))} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 13, color: C.g5 }}>
              {Object.values(cantidades).filter(v => Number(v) > 0).length} ítems con cantidad
            </span>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={() => { setModalRem(false); setCantidades({}); setEditRemId(null) }}>Cancelar</Btn>
              <Btn variant="primary" onClick={guardarRemision} disabled={saving}>
                {saving ? 'Guardando…' : editRemId ? 'Guardar cambios' : 'Crear remisión'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal ítems de control */}
      {modalControl && remSel && (
        <Modal title={`Control interno — REM ${remSel.numero}`} onClose={() => setModalControl(false)} wide>
          <p style={{ fontSize: 13, color: C.g5, marginBottom: 12 }}>
            Agrega piezas de control interno (jambas, marcos, cajones, etc.) que no se facturan pero necesitas registrar.
          </p>
          <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${C.g2}`, borderRadius: 8, marginBottom: 12 }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead style={{ background: C.g0 }}>
                <tr>
                  {['Descripción *','UM','Cantidad *','Notas',''].map((h,i) => (
                    <th key={i} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.g5, borderBottom: `2px solid ${C.g2}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itemsControl.map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.g1}` }}>
                    <td style={{ padding: '6px 8px' }}>
                      <input value={row.descripcion} onChange={e => setItemsControl(rows => rows.map((r,j) => j===i ? {...r, descripcion: e.target.value} : r))}
                        placeholder="Ej: Jamba PT-01, Marco baño..." style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: '6px 8px', width: 70 }}>
                      <select value={row.unidad} onChange={e => setItemsControl(rows => rows.map((r,j) => j===i ? {...r, unidad: e.target.value} : r))}
                        style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12, background: C.wh }}>
                        {['und','ml','m2','kg','par','juego'].map(u => <option key={u}>{u}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '6px 8px', width: 90 }}>
                      <input type="number" value={row.cantidad} onChange={e => setItemsControl(rows => rows.map((r,j) => j===i ? {...r, cantidad: e.target.value} : r))}
                        placeholder="0" style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12, textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <input value={row.notas || ''} onChange={e => setItemsControl(rows => rows.map((r,j) => j===i ? {...r, notas: e.target.value} : r))}
                        placeholder="Opcional" style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: '6px 8px', width: 36 }}>
                      {itemsControl.length > 1 && (
                        <button onClick={() => setItemsControl(rows => rows.filter((_,j) => j !== i))}
                          style={{ background: 'none', border: 'none', color: C.rd, cursor: 'pointer', fontSize: 18 }}>×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Btn size="sm" onClick={() => setItemsControl(r => [...r, { descripcion: '', unidad: 'und', cantidad: '' }])}>+ Agregar fila</Btn>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setModalControl(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardarControl} disabled={saving}>
              {saving ? 'Guardando…' : '✓ Guardar'}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
