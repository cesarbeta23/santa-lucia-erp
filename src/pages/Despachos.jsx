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
    items_acta_facturacion = [], lotes_produccion = [],
  } = dbData

  const [vista, setVista]             = useState('lista')       // lista | proyecto | remision
  const [proySel, setProySel]         = useState(null)
  const [contratoSel, setContratoSel] = useState(null)
  const [remSel, setRemSel]           = useState(null)
  const [modalRem, setModalRem]       = useState(false)
  const [modalControl, setModalControl] = useState(false)
  const [remExpandida, setRemExpandida]   = useState(null)
  const [formRem, setFormRem]         = useState({ numero: '', fecha: '', transportador: '', notas: '', lote_id: null })
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

    // Generar PDF via ventana de impresión
    const fmt2 = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0)
    const totalXFact = pendientes.reduce((s, i) => s + i.xFact, 0)
    const totalCobro = pendientes.reduce((s, i) => s + i.totalFact, 0)

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe de Cobro — ${payload.proyecto}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a2e; background: white; }
  .page { padding: 28px 32px; max-width: 900px; margin: 0 auto; }

  /* CABECERA */
  .header { background: #1F3A5F; color: white; padding: 18px 24px; border-radius: 8px 8px 0 0; }
  .header h1 { font-size: 18px; font-weight: 800; letter-spacing: -.02em; margin-bottom: 2px; }
  .header p  { font-size: 11px; color: #93C5FD; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  .subheader { background: #1E293B; padding: 10px 24px; border-radius: 0 0 8px 8px; margin-bottom: 20px;
               display: flex; gap: 32px; flex-wrap: wrap; }
  .subheader .info-item { display: flex; flex-direction: column; }
  .subheader .info-label { font-size: 9px; color: #64748B; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 2px; }
  .subheader .info-value { font-size: 12px; color: white; font-weight: 700; }

  /* TABLA */
  table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  thead tr { background: #1E3A5F; }
  thead th { padding: 9px 10px; color: white; font-size: 9px; font-weight: 700;
             text-transform: uppercase; letter-spacing: .06em; text-align: right; border: 1px solid #2D5A8E; }
  thead th:nth-child(1) { text-align: center; width: 80px; }
  thead th:nth-child(2) { text-align: left; }
  thead th:nth-child(3) { text-align: center; width: 50px; }
  tbody tr:nth-child(even) { background: #F8FAFC; }
  tbody tr:nth-child(odd)  { background: #FFFFFF; }
  tbody td { padding: 8px 10px; border: 1px solid #E2E8F0; font-size: 10px; text-align: right; vertical-align: middle; }
  tbody td:nth-child(1) { text-align: center; font-weight: 700; color: #1D4ED8; }
  tbody td:nth-child(2) { text-align: left; max-width: 260px; }
  tbody td:nth-child(3) { text-align: center; color: #64748B; }
  tbody td:nth-child(6) { font-weight: 700; }
  tbody td:nth-child(8) { font-weight: 700; color: #1D4ED8; }

  /* TOTALES */
  .total-row { background: #1E3A5F !important; }
  .total-row td { color: white !important; font-weight: 700 !important; font-size: 11px !important;
                  padding: 11px 10px !important; border-color: #2D5A8E !important; }
  .total-row .grand { background: #1D4ED8; font-size: 13px !important; }

  /* NOTA */
  .nota { margin-top: 16px; padding: 12px 16px; background: #F1F5F9;
          border-left: 3px solid #1E3A5F; border-radius: 4px; font-size: 9px; color: #64748B; line-height: 1.6; }
  .nota strong { color: #1E3A5F; }

  /* FOOTER */
  .footer { margin-top: 20px; text-align: center; font-size: 9px; color: #94A3B8; padding-top: 12px;
            border-top: 1px solid #E2E8F0; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 16px; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="page">
  <!-- Botón imprimir (solo en pantalla) -->
  <div class="no-print" style="text-align:right; margin-bottom:16px;">
    <button onclick="window.print()" style="background:#1E3A5F;color:white;border:none;padding:10px 24px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;">
      🖨️ Guardar / Imprimir PDF
    </button>
  </div>

  <!-- Cabecera -->
  <div class="header">
    <h1>🪵 Santa Lucía Muebles y Pisos S.A.S.</h1>
    <p>Informe de Cobro — Pendiente por Facturar</p>
  </div>
  <div class="subheader">
    <div class="info-item"><span class="info-label">Constructora</span><span class="info-value">${payload.constructora || '—'}</span></div>
    <div class="info-item"><span class="info-label">Proyecto / Obra</span><span class="info-value">${payload.proyecto || '—'}</span></div>
    <div class="info-item"><span class="info-label">Contrato</span><span class="info-value">#${payload.contrato || '—'} (${payload.tipo || '—'})</span></div>
    <div class="info-item"><span class="info-label">Fecha</span><span class="info-value">${payload.fecha || new Date().toLocaleDateString('es-CO')}</span></div>
    <div class="info-item"><span class="info-label">NIT</span><span class="info-value">900.602.879-5</span></div>
  </div>

  <!-- Tabla -->
  <table>
    <thead>
      <tr>
        <th>Ref</th><th style="text-align:left">Descripción</th><th>UM</th>
        <th>Despachado</th><th>Facturado</th><th>X Facturar</th>
        <th>Vr. Unitario</th><th>Total a Cobrar</th>
      </tr>
    </thead>
    <tbody>
      ${pendientes.map((it, i) => `
      <tr>
        <td>${it.ref}</td>
        <td style="text-align:left">${it.descripcion}</td>
        <td>${it.unidad}</td>
        <td>${Number(it.despachado).toLocaleString('es-CO')}</td>
        <td>${Number(it.facturado).toLocaleString('es-CO')}</td>
        <td>${Number(it.xFact).toLocaleString('es-CO')}</td>
        <td>${fmt2(it.vrUnit)}</td>
        <td>${fmt2(it.totalFact)}</td>
      </tr>`).join('')}
    </tbody>
    <tr class="total-row">
      <td colspan="5" style="text-align:right">TOTAL PENDIENTE POR FACTURAR</td>
      <td>${totalXFact.toLocaleString('es-CO')}</td>
      <td></td>
      <td class="grand">${fmt2(totalCobro)}</td>
    </tr>
  </table>

  <!-- Nota -->
  <div class="nota">
    <strong>Nota:</strong> Los valores relacionados corresponden al suministro <strong>sin IVA</strong>.
    El IVA del 19% será discriminado en la factura electrónica correspondiente.<br>
    Santa Lucía Muebles y Pisos S.A.S. · NIT 900.602.879-5 · Tel: 311.341.04.58 · cesarbeta@gmail.com
  </div>

  <!-- Footer -->
  <div class="footer">
    Documento generado el ${new Date().toLocaleDateString('es-CO', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}
  </div>
</div>
</body>
</html>`

    const ventana = window.open('', '_blank', 'width=960,height=700')
    if (ventana) {
      ventana.document.write(html)
      ventana.document.close()
      toast('Informe abierto — usa el botón para guardar como PDF', 'ok')
    } else {
      toast('Permite ventanas emergentes para generar el PDF', 'err')
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
          lote_id: formRem.lote_id || null,
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
      // Verificar excesos vs contrato
      const excesos = []
      cantValidas.forEach(([itemId, cant]) => {
        const ic = items_contrato.find(i => i.id === itemId)
        if (!ic) return
        const yaDesp = cantDespachada(itemId)
        const nuevaDesp = yaDesp + Number(cant)
        const contratado = Number(ic.cantidad || 0)
        if (nuevaDesp > contratado) {
          excesos.push({ ref: ic.ref, contratado, yaDesp, estaCant: Number(cant), nuevaDesp, exceso: nuevaDesp - contratado })
        }
      })
      if (excesos.length) {
        const msg = excesos.map(e => `• ${e.ref}: contrato ${e.contratado}, ya despachado ${e.yaDesp}, esta remisión ${e.estaCant} → total ${e.nuevaDesp} (exceso: ${e.exceso})`).join('\n')
        const justificacion = window.prompt(
          `⚠️ ATENCIÓN — Estas cantidades superan el contrato:\n\n${msg}\n\nPara continuar, escribe una justificación (o Cancelar para ajustar):`,
          ''
        )
        if (justificacion === null) { setSaving(false); return }
        if (!justificacion.trim()) { toast('Debes escribir una justificación para despachar cantidades extra', 'err'); setSaving(false); return }
        // Guardar con nota de exceso
        formRem.notas = (formRem.notas ? formRem.notas + ' | ' : '') + `EXCESO JUSTIFICADO: ${justificacion}`
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
                        <th style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: C.am, borderBottom: `2px solid ${C.g2}`, width: 90 }}>FALTANTE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itsContr.map(it => {
                        const contratado = Number(it.cantidad || 0)
                        const despachado = cantDespachada(it.id)
                        const faltante   = Math.max(0, contratado - despachado)
                        const completo   = despachado >= contratado
                        return (
                          <tr key={it.id} style={{ borderBottom: `1px solid ${C.g1}`, background: completo ? '#F0FDF4' : '' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: C.or }}>{it.ref}</td>
                            <td style={{ padding: '8px 12px', maxWidth: 280 }}>{it.descripcion}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center', color: C.g5 }}>{it.unidad}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{contratado.toLocaleString('es-CO')}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: C.gnD }}>{despachado.toLocaleString('es-CO')}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: faltante > 0 ? 700 : 400, color: faltante > 0 ? C.am : C.gnD }}>{faltante.toLocaleString('es-CO')}</td>
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
                            const itsRem   = items_remision.filter(i => i.remision_id === rem.id)
                            const itsCtrl  = items_control_despacho.filter(i => i.remision_id === rem.id)
                            const totalRem = itsRem.reduce((s, i) => s + Number(i.cantidad || 0), 0)
                            const abierta  = remExpandida === rem.id
                            return (
                              <>
                                <tr key={rem.id}
                                  onClick={() => setRemExpandida(abierta ? null : rem.id)}
                                  style={{ borderBottom: abierta ? 'none' : `1px solid ${C.g1}`, cursor: 'pointer', background: abierta ? '#F0F7FF' : '' }}
                                  onMouseEnter={e => !abierta && (e.currentTarget.style.background = C.g0)}
                                  onMouseLeave={e => !abierta && (e.currentTarget.style.background = '')}
                                >
                                  <td style={{ padding: '10px 12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span style={{ color: C.g4, fontSize: 11, transition: 'transform .2s', display: 'inline-block', transform: abierta ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
                                      <span style={{ fontWeight: 700, color: C.or }}>REM {rem.numero}</span>
                                    </div>
                                    {rem.notas && !abierta && <div style={{ fontSize: 10, color: C.g4, marginTop: 2, marginLeft: 20 }}>{rem.notas}</div>}
                                  </td>
                                  <td style={{ padding: '10px 12px', color: C.g5, whiteSpace: 'nowrap' }}>📅 {fmtDate(rem.fecha)}</td>
                                  <td style={{ padding: '10px 12px' }}>
                                    {rem.lote_id ? (
                                      <Badge color="blue">{lotes_produccion.find(l => l.id === rem.lote_id)?.nombre || 'Lote'}</Badge>
                                    ) : <span style={{ color: C.g3, fontSize: 12 }}>—</span>}
                                  </td>
                                  <td style={{ padding: '10px 12px', color: C.g5 }}>{rem.transportador || '—'}</td>
                                  <td style={{ padding: '10px 12px', textAlign: 'center', color: C.g5, fontSize: 12 }}>
                                    {itsRem.length} ítem(s)
                                  </td>
                                  <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700 }}>{totalRem.toLocaleString('es-CO')}</td>
                                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                    {itsCtrl.length > 0 ? (
                                      <span style={{ background: C.amL, border: `1px solid #FDE68A`, borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#B45309' }}>
                                        {itsCtrl.length} ctrl
                                      </span>
                                    ) : <span style={{ color: C.g3 }}>—</span>}
                                  </td>
                                  <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                                    <div style={{ display: 'flex', gap: 5 }}>
                                      <Btn size="sm" onClick={() => { setRemSel(rem); setItemsControl([{ descripcion: '', unidad: 'und', cantidad: '' }]); setModalControl(true) }}>+ Control</Btn>
                                      <Btn size="sm" onClick={() => abrirEditarRemision(rem)}>Editar</Btn>
                                      <Btn size="sm" variant="danger" onClick={() => eliminarRemision(rem.id)}>Eliminar</Btn>
                                    </div>
                                  </td>
                                </tr>

                                {/* Acordeón — detalle de la remisión */}
                                {abierta && (
                                  <tr key={rem.id + '-det'} style={{ borderBottom: `1px solid ${C.g2}` }}>
                                    <td colSpan={7} style={{ padding: '0 0 16px 32px', background: '#F0F7FF' }}>
                                      <div style={{ display: 'grid', gridTemplateColumns: itsCtrl.length ? '1fr 1fr' : '1fr', gap: 16, paddingTop: 12 }}>

                                        {/* Ítems del contrato */}
                                        <div>
                                          <div style={{ fontSize: 11, fontWeight: 700, color: '#1E3A5F', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                                            📦 Ítems despachados
                                          </div>
                                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                            <thead>
                                              <tr style={{ background: '#1E3A5F' }}>
                                                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'white', fontSize: 10, fontWeight: 700 }}>Ref</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'white', fontSize: 10, fontWeight: 700 }}>Descripción</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'center', color: 'white', fontSize: 10, fontWeight: 700 }}>UM</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'right', color: 'white', fontSize: 10, fontWeight: 700 }}>Cantidad</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {itsRem.map((ir, idx) => {
                                                const ic = items_contrato.find(x => x.id === ir.item_contrato_id)
                                                return (
                                                  <tr key={ir.id} style={{ background: idx % 2 === 0 ? 'white' : '#F1F5F9', borderBottom: '1px solid #E2E8F0' }}>
                                                    <td style={{ padding: '6px 10px', fontWeight: 700, color: '#1D4ED8' }}>{ic?.ref || '—'}</td>
                                                    <td style={{ padding: '6px 10px', maxWidth: 240 }}>{ic?.descripcion || '—'}</td>
                                                    <td style={{ padding: '6px 10px', textAlign: 'center', color: '#636366' }}>{ic?.unidad || '—'}</td>
                                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>{Number(ir.cantidad).toLocaleString('es-CO')}</td>
                                                  </tr>
                                                )
                                              })}
                                              <tr style={{ background: '#1E3A5F' }}>
                                                <td colSpan={3} style={{ padding: '7px 10px', color: 'white', fontWeight: 700, fontSize: 11, textAlign: 'right' }}>TOTAL</td>
                                                <td style={{ padding: '7px 10px', color: 'white', fontWeight: 800, textAlign: 'right', fontSize: 13 }}>{totalRem.toLocaleString('es-CO')}</td>
                                              </tr>
                                            </tbody>
                                          </table>
                                        </div>

                                        {/* Control interno */}
                                        {itsCtrl.length > 0 && (
                                          <div>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#B45309', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                                              🔧 Control interno (no facturable)
                                            </div>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                              <thead>
                                                <tr style={{ background: '#FEF3C7' }}>
                                                  <th style={{ padding: '6px 10px', textAlign: 'left', color: '#B45309', fontSize: 10, fontWeight: 700 }}>Descripción</th>
                                                  <th style={{ padding: '6px 10px', textAlign: 'center', color: '#B45309', fontSize: 10, fontWeight: 700 }}>UM</th>
                                                  <th style={{ padding: '6px 10px', textAlign: 'right', color: '#B45309', fontSize: 10, fontWeight: 700 }}>Cantidad</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {itsCtrl.map((ic, idx) => (
                                                  <tr key={ic.id} style={{ background: idx % 2 === 0 ? 'white' : '#FFFBEB', borderBottom: '1px solid #FDE68A' }}>
                                                    <td style={{ padding: '6px 10px' }}>{ic.descripcion}</td>
                                                    <td style={{ padding: '6px 10px', textAlign: 'center', color: '#636366' }}>{ic.unidad}</td>
                                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{Number(ic.cantidad).toLocaleString('es-CO')}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                            {itsCtrl[0]?.notas && (
                                              <div style={{ fontSize: 11, color: '#92400E', marginTop: 6, fontStyle: 'italic' }}>
                                                Nota: {itsCtrl[0].notas}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>

                                      {rem.notas && (
                                        <div style={{ marginTop: 10, fontSize: 11, color: '#636366', fontStyle: 'italic', paddingTop: 8, borderTop: '1px dashed #CBD5E1' }}>
                                          📝 {rem.notas}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </>
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
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: C.g5, display: 'block', marginBottom: 5, fontWeight: 500 }}>Lote de producción</label>
            <select value={formRem.lote_id || ''} onChange={e => setFormRem(f => ({ ...f, lote_id: e.target.value || null }))}
              style={{ width: '100%', padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
              <option value="">— Sin lote —</option>
              {lotes_produccion.filter(l => l.contrato_id === contratoSel?.id).sort((a,b) => a.numero-b.numero).map(l => (
                <option key={l.id} value={l.id}>{l.nombre}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
          <div style={{ display: 'none' }}>
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
