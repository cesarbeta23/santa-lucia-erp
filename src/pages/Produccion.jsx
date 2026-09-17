import { useState } from 'react'
import { C, Btn, Inp, Sel, Txt, Modal, Badge, Empty, SectionHeader, card, fmt, fmtDate, Progress } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

const ESTADOS_LOTE = {
  pendiente:   { label: 'Pendiente',   color: 'gray'   },
  en_proceso:  { label: 'En proceso',  color: 'amber'  },
  completado:  { label: 'Completado',  color: 'green'  },
}

export default function Produccion({ dbData, setDbData, toast }) {
  const {
    proyectos = [], constructoras = [], contratos = [],
    items_contrato = [], lotes_produccion = [], items_lote = [],
    remisiones = [], items_remision = [],
  } = dbData

  const [vista, setVista]           = useState('lista')   // lista | proyecto | contrato
  const [proySel, setProySel]       = useState(null)
  const [contratoSel, setContratoSel] = useState(null)
  const [modalLotes, setModalLotes] = useState(false)
  const [nLotes, setNLotes]         = useState(4)
  const [editando, setEditando]     = useState({})        // { loteId_itemId: valor }
  const [saving, setSaving]         = useState(false)
  const [filtProy, setFiltProy]     = useState('')

  // ── Helpers ───────────────────────────────────────────────
  const cantDespLote = (loteId, itemContratoId) =>
    remisiones
      .filter(r => r.lote_id === loteId)
      .flatMap(r => items_remision.filter(i => i.remision_id === r.id && i.item_contrato_id === itemContratoId))
      .reduce((s, i) => s + Number(i.cantidad || 0), 0)

  const lotesContrato = (cid) =>
    lotes_produccion.filter(l => l.contrato_id === cid).sort((a, b) => a.numero - b.numero)

  const itemsLote = (loteId) =>
    items_lote.filter(i => i.lote_id === loteId)

  const totalLote = (loteId) =>
    items_lote.filter(i => i.lote_id === loteId).reduce((s, i) => s + Number(i.cantidad || 0), 0)

  const pctLote = (loteId) => {
    const its = items_lote.filter(i => i.lote_id === loteId)
    const plan = its.reduce((s, i) => s + Number(i.cantidad || 0), 0)
    const desp = its.reduce((s, i) => s + cantDespLote(loteId, i.item_contrato_id), 0)
    return plan > 0 ? (desp / plan) * 100 : 0
  }

  // Proyectos con contratos de suministro o todo_costo
  const proyConProduccion = proyectos.filter(p =>
    contratos.some(c => c.proyecto_id === p.id && (c.tipo === 'suministro' || c.tipo === 'todo_costo'))
  )

  // ── Generar lotes automáticamente ────────────────────────
  async function generarLotes() {
    if (!contratoSel || nLotes < 1) return
    const n = Number(nLotes)
    const itsContr = items_contrato.filter(i => i.contrato_id === contratoSel.id)
    setSaving(true)
    try {
      // Eliminar lotes anteriores del contrato
      const lotesAnt = lotes_produccion.filter(l => l.contrato_id === contratoSel.id)
      for (const l of lotesAnt) {
        await supabase.from('items_lote').delete().eq('lote_id', l.id)
        await supabase.from('lotes_produccion').delete().eq('id', l.id)
      }

      // Crear N lotes
      const lotesNuevos = []
      for (let i = 1; i <= n; i++) {
        const { data: lote, error } = await supabase.from('lotes_produccion').insert({
          contrato_id: contratoSel.id,
          proyecto_id: proySel.id,
          numero: i,
          nombre: `Lote ${i}`,
          estado: 'pendiente',
        }).select().single()
        if (error) throw error
        lotesNuevos.push(lote)
      }

      // Distribuir ítems en lotes
      const itemsLoteNuevos = []
      for (const it of itsContr) {
        const cant = Number(it.cantidad || 0)
        if (cant < 10) {
          // Cantidad pequeña → todo en Lote 1
          const { data: il, error } = await supabase.from('items_lote').insert({
            lote_id: lotesNuevos[0].id,
            item_contrato_id: it.id,
            cantidad: cant,
          }).select().single()
          if (error) throw error
          itemsLoteNuevos.push(il)
          // Resto de lotes en 0
          for (let i = 1; i < n; i++) {
            const { data: il2 } = await supabase.from('items_lote').insert({
              lote_id: lotesNuevos[i].id,
              item_contrato_id: it.id,
              cantidad: 0,
            }).select().single()
            if (il2) itemsLoteNuevos.push(il2)
          }
        } else {
          // Dividir uniformemente
          const base     = Math.floor(cant / n)
          const residuo  = cant - base * n
          for (let i = 0; i < n; i++) {
            const cantLote = base + (i === 0 ? residuo : 0)  // residuo en lote 1
            const { data: il, error } = await supabase.from('items_lote').insert({
              lote_id: lotesNuevos[i].id,
              item_contrato_id: it.id,
              cantidad: cantLote,
            }).select().single()
            if (error) throw error
            itemsLoteNuevos.push(il)
          }
        }
      }

      setDbData(d => ({
        ...d,
        lotes_produccion: [
          ...d.lotes_produccion.filter(l => l.contrato_id !== contratoSel.id),
          ...lotesNuevos,
        ],
        items_lote: [
          ...d.items_lote.filter(i => !lotesAnt.some(l => l.id === i.lote_id)),
          ...itemsLoteNuevos,
        ],
      }))
      toast(`${n} lotes generados correctamente`, 'ok')
      setModalLotes(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
  }

  // ── Editar cantidad de un ítem en un lote ─────────────────
  async function guardarItemLote(itemLoteId, nuevaCant) {
    const nueva = Number(nuevaCant)
    if (isNaN(nueva) || nueva < 0) return
    try {
      const { data, error } = await supabase.from('items_lote').update({ cantidad: nueva }).eq('id', itemLoteId).select().single()
      if (error) throw error
      setDbData(d => ({ ...d, items_lote: d.items_lote.map(i => i.id === itemLoteId ? data : i) }))
      toast('Cantidad actualizada', 'ok')
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setEditando(e => { const n = { ...e }; delete n[itemLoteId]; return n })
  }

  // ── Cambiar estado de un lote ─────────────────────────────
  async function cambiarEstado(loteId, estado) {
    try {
      const { data, error } = await supabase.from('lotes_produccion').update({ estado }).eq('id', loteId).select().single()
      if (error) throw error
      setDbData(d => ({ ...d, lotes_produccion: d.lotes_produccion.map(l => l.id === loteId ? data : l) }))
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  // ── Vista contrato — cuadro de lotes ─────────────────────
  const renderContrato = () => {
    const itsContr = items_contrato.filter(i => i.contrato_id === contratoSel.id)
    const lotes    = lotesContrato(contratoSel.id)
    const tipo     = contratoSel.tipo === 'suministro' ? '📦 Suministro' : '📋 Todo Costo'

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Btn onClick={() => { setVista('proyecto'); setContratoSel(null) }}>← {proySel?.nombre}</Btn>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{tipo} {contratoSel.numero ? `#${contratoSel.numero}` : ''}</h1>
            <div style={{ fontSize: 13, color: C.g5 }}>{proySel?.nombre} · {fmt(contratoSel.valor_total)}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Btn onClick={() => setModalLotes(true)}>
              {lotes.length ? '🔄 Regenerar lotes' : '⚙️ Definir lotes'}
            </Btn>
          </div>
        </div>

        {lotes.length === 0 ? (
          <Empty icon="🏭" title="Sin lotes definidos"
            desc="Define cuántos lotes de producción tiene este contrato para dividir las cantidades automáticamente."
            action={<Btn variant="primary" onClick={() => setModalLotes(true)}>⚙️ Definir lotes</Btn>} />
        ) : (
          <div>
            {/* Resumen de lotes */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(lotes.length, 5)}, 1fr)`, gap: 10, marginBottom: 20 }}>
              {lotes.map(lote => {
                const pct  = pctLote(lote.id)
                const est  = ESTADOS_LOTE[lote.estado] || ESTADOS_LOTE.pendiente
                const nRem = remisiones.filter(r => r.lote_id === lote.id).length
                return (
                  <div key={lote.id} style={{ ...card, padding: '12px 14px', borderTop: `3px solid ${lote.estado==='completado'?C.gn:lote.estado==='en_proceso'?C.am:C.g3}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{lote.nombre}</span>
                      <Badge color={est.color}>{est.label}</Badge>
                    </div>
                    <Progress value={pct} />
                    <div style={{ fontSize: 11, color: C.g5, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{Math.round(pct)}% despachado</span>
                      <span>{nRem} rem.</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                      {lote.estado !== 'en_proceso' && lote.estado !== 'completado' &&
                        <Btn size="sm" onClick={() => cambiarEstado(lote.id, 'en_proceso')}>▶ Iniciar</Btn>}
                      {lote.estado === 'en_proceso' &&
                        <Btn size="sm" variant="success" onClick={() => cambiarEstado(lote.id, 'completado')}>✓ Completar</Btn>}
                      {lote.estado === 'completado' &&
                        <Btn size="sm" onClick={() => cambiarEstado(lote.id, 'en_proceso')}>↩ Reabrir</Btn>}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Cuadro de planificación — ítems × lotes */}
            <div style={{ fontSize: 11, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              Cuadro de planificación por lote
            </div>
            <div style={{ ...card, padding: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
                <thead>
                  <tr style={{ background: '#1E3A5F' }}>
                    <th style={{ padding: '9px 12px', textAlign: 'left', color: 'white', fontSize: 10, fontWeight: 700, position: 'sticky', left: 0, background: '#1E3A5F', zIndex: 1 }}>REF</th>
                    <th style={{ padding: '9px 12px', textAlign: 'left', color: 'white', fontSize: 10, fontWeight: 700 }}>DESCRIPCIÓN</th>
                    <th style={{ padding: '9px 12px', textAlign: 'center', color: 'white', fontSize: 10, fontWeight: 700 }}>UM</th>
                    <th style={{ padding: '9px 12px', textAlign: 'right', color: 'white', fontSize: 10, fontWeight: 700 }}>CONTRATO</th>
                    {lotes.map(l => (
                      <th key={l.id} style={{ padding: '9px 10px', textAlign: 'center', color: 'white', fontSize: 10, fontWeight: 700, minWidth: 90, borderLeft: '1px solid #2D5A8E' }}>
                        {l.nombre}
                        <div style={{ fontSize: 9, color: '#93C5FD', fontWeight: 400 }}>
                          <Badge color={ESTADOS_LOTE[l.estado]?.color || 'gray'} >{ESTADOS_LOTE[l.estado]?.label}</Badge>
                        </div>
                      </th>
                    ))}
                    <th style={{ padding: '9px 10px', textAlign: 'right', color: '#93C5FD', fontSize: 10, fontWeight: 700, borderLeft: '1px solid #2D5A8E' }}>TOTAL PLAN</th>
                    <th style={{ padding: '9px 10px', textAlign: 'right', color: '#93C5FD', fontSize: 10, fontWeight: 700 }}>DIFERENCIA</th>
                  </tr>
                </thead>
                <tbody>
                  {itsContr.map((it, idx) => {
                    const contratado = Number(it.cantidad || 0)
                    const totalPlan  = lotes.reduce((s, l) => {
                      const il = items_lote.find(i => i.lote_id === l.id && i.item_contrato_id === it.id)
                      return s + Number(il?.cantidad || 0)
                    }, 0)
                    const diff = totalPlan - contratado
                    return (
                      <tr key={it.id} style={{ borderBottom: `1px solid ${C.g1}`, background: idx % 2 === 0 ? 'white' : C.g0 }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: '#1D4ED8', position: 'sticky', left: 0, background: idx % 2 === 0 ? 'white' : C.g0 }}>{it.ref}</td>
                        <td style={{ padding: '8px 12px', maxWidth: 260 }}>{it.descripcion}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', color: C.g5 }}>{it.unidad}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{contratado.toLocaleString('es-CO')}</td>
                        {lotes.map(l => {
                          const il     = items_lote.find(i => i.lote_id === l.id && i.item_contrato_id === it.id)
                          const cant   = Number(il?.cantidad || 0)
                          const desp   = il ? cantDespLote(l.id, it.id) : 0
                          const key    = il?.id || `${l.id}_${it.id}`
                          const editVal = editando[key]
                          return (
                            <td key={l.id} style={{ padding: '6px 8px', textAlign: 'center', borderLeft: `1px solid ${C.g1}` }}>
                              {editVal !== undefined ? (
                                <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
                                  <input type="number" value={editVal}
                                    onChange={e => setEditando(ed => ({ ...ed, [key]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter' && il) guardarItemLote(il.id, editVal); if (e.key === 'Escape') setEditando(ed => { const n={...ed}; delete n[key]; return n }) }}
                                    autoFocus style={{ width: 60, padding: '3px 5px', border: '1px solid #F97316', borderRadius: 4, fontSize: 12, textAlign: 'right' }} />
                                  {il && <button onClick={() => guardarItemLote(il.id, editVal)} style={{ background:'#15803D', border:'none', color:'white', borderRadius:4, padding:'2px 6px', cursor:'pointer', fontSize:11 }}>✓</button>}
                                </div>
                              ) : (
                                <div>
                                  <span onClick={() => setEditando(ed => ({ ...ed, [key]: String(cant) }))}
                                    title="Clic para editar"
                                    style={{ cursor: 'pointer', fontWeight: cant > 0 ? 600 : 400, color: cant > 0 ? C.bk : C.g3, borderBottom: '1px dashed #C7C7CC', paddingBottom: 1 }}>
                                    {cant > 0 ? cant.toLocaleString('es-CO') : '—'}
                                  </span>
                                  {desp > 0 && (
                                    <div style={{ fontSize: 10, color: C.gnD, marginTop: 2 }}>✓ {desp.toLocaleString('es-CO')} desp.</div>
                                  )}
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, borderLeft: `1px solid ${C.g2}`, color: diff === 0 ? C.gnD : C.rd }}>
                          {totalPlan.toLocaleString('es-CO')}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, color: diff === 0 ? C.gnD : diff > 0 ? C.am : C.rd }}>
                          {diff === 0 ? '✓' : diff > 0 ? `+${diff}` : `${diff}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#1E3A5F', borderTop: `2px solid ${C.g2}` }}>
                    <td colSpan={3} style={{ padding: '9px 12px', color: 'white', fontWeight: 700, fontSize: 11 }}>TOTAL</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: 'white', fontWeight: 700 }}>
                      {itsContr.reduce((s, it) => s + Number(it.cantidad||0), 0).toLocaleString('es-CO')}
                    </td>
                    {lotes.map(l => (
                      <td key={l.id} style={{ padding: '9px 10px', textAlign: 'center', color: 'white', fontWeight: 700, borderLeft: '1px solid #2D5A8E' }}>
                        {items_lote.filter(i => i.lote_id === l.id).reduce((s,i) => s+Number(i.cantidad||0), 0).toLocaleString('es-CO')}
                      </td>
                    ))}
                    <td colSpan={2} style={{ padding: '9px 10px', color: 'white', textAlign: 'right', borderLeft: '1px solid #2D5A8E' }}>
                      {items_lote.filter(i => lotes.some(l => l.id === i.lote_id)).reduce((s,i) => s+Number(i.cantidad||0), 0).toLocaleString('es-CO')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Modal definir lotes */}
        {modalLotes && (
          <Modal title="Definir lotes de producción" onClose={() => setModalLotes(false)}>
            <p style={{ fontSize: 13, color: C.g5, marginBottom: 16 }}>
              Define cuántos lotes tiene este contrato. El sistema dividirá las cantidades automáticamente.<br/>
              <span style={{ fontSize: 12, color: C.g4 }}>Ítems con menos de 10 unidades irán completos en el Lote 1.</span>
            </p>
            <Inp label="Número de lotes *" type="number" value={nLotes}
              onChange={e => setNLotes(Math.max(1, Number(e.target.value)))}
              hint="Ejemplo: 5 lotes para una obra de 20 pisos en grupos de 4" />
            {lotes_produccion.filter(l => l.contrato_id === contratoSel.id).length > 0 && (
              <div style={{ background: C.rdL, border: `1px solid #FECACA`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: C.rd }}>
                ⚠️ Regenerar lotes eliminará los lotes actuales y sus asignaciones. Las remisiones ya enviadas conservarán su lote.
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <Btn onClick={() => setModalLotes(false)}>Cancelar</Btn>
              <Btn variant="primary" onClick={generarLotes} disabled={saving}>
                {saving ? 'Generando…' : `Generar ${nLotes} lote(s)`}
              </Btn>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // ── Vista proyecto ────────────────────────────────────────
  const renderProyecto = () => {
    const contrSum = contratos.filter(c => c.proyecto_id === proySel.id && (c.tipo === 'suministro' || c.tipo === 'todo_costo'))
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <Btn onClick={() => { setVista('lista'); setProySel(null) }}>← Proyectos</Btn>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>🏭 Producción — {proySel.nombre}</h1>
        </div>
        {contrSum.length === 0 ? (
          <Empty icon="📄" title="Sin contratos de suministro" desc="Este proyecto no tiene contratos de suministro." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {contrSum.map(c => {
              const lotes = lotesContrato(c.id)
              const pctGen = lotes.length > 0
                ? lotes.reduce((s, l) => s + pctLote(l.id), 0) / lotes.length
                : 0
              const lotesComp = lotes.filter(l => l.estado === 'completado').length
              return (
                <div key={c.id} style={{
                  ...card, cursor: 'pointer',
                  borderLeft: `4px solid ${lotes.length === 0 ? C.g3 : lotesComp === lotes.length && lotes.length > 0 ? C.gn : C.am}`,
                }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.1)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.06)'}
                  onClick={() => { setContratoSel(c); setVista('contrato') }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>
                        {c.tipo === 'suministro' ? '📦' : '📋'} {c.tipo === 'suministro' ? 'Suministro' : 'Todo Costo'}
                        {c.numero ? ` #${c.numero}` : ''}
                      </span>
                      <span style={{ fontSize: 12, color: C.g5, marginLeft: 12 }}>{fmt(c.valor_total)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {lotes.length > 0 ? (
                        <>
                          <span style={{ fontSize: 12, color: C.g5 }}>{lotes.length} lotes · {lotesComp} completados</span>
                          <Badge color={lotesComp === lotes.length ? 'green' : 'amber'}>
                            {Math.round(pctGen)}% despachado
                          </Badge>
                        </>
                      ) : (
                        <Badge color="gray">Sin lotes</Badge>
                      )}
                    </div>
                  </div>
                  {lotes.length > 0 && <Progress value={pctGen} />}
                  {lotes.length === 0 && (
                    <div style={{ fontSize: 12, color: C.g4, fontStyle: 'italic' }}>
                      Clic para definir los lotes de producción
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Vista lista ───────────────────────────────────────────
  return (
    <div>
      {vista === 'lista' && (
        <div>
          <SectionHeader title="Producción">
            <span style={{ fontSize: 13, color: C.g5 }}>Planificación de lotes por contrato</span>
          </SectionHeader>
          <div style={{ marginBottom: 20 }}>
            <select value={filtProy} onChange={e => setFiltProy(e.target.value)}
              style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
              <option value="">Todos los proyectos</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          {proyConProduccion.filter(p => !filtProy || p.id === filtProy).length === 0 ? (
            <Empty icon="🏭" title="Sin proyectos con contratos de suministro" />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: 12 }}>
              {proyConProduccion.filter(p => !filtProy || p.id === filtProy).map(p => {
                const constrNom = constructoras.find(c => c.id === p.constructora_id)?.nombre || '—'
                const contrSum  = contratos.filter(c => c.proyecto_id === p.id && (c.tipo === 'suministro' || c.tipo === 'todo_costo'))
                const lotesP    = lotes_produccion.filter(l => l.proyecto_id === p.id)
                const pctProm   = lotesP.length > 0 ? lotesP.reduce((s,l) => s+pctLote(l.id),0)/lotesP.length : 0
                return (
                  <div key={p.id} style={{ ...card, cursor: 'pointer', borderLeft: `4px solid #1E3A5F` }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.1)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.06)'}
                    onClick={() => { setProySel(p); setVista('proyecto') }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{p.nombre}</div>
                    <div style={{ fontSize: 12, color: C.g5, marginBottom: 10 }}>
                      🏢 {constrNom} · {contrSum.length} contrato(s) · {lotesP.length} lote(s)
                    </div>
                    {lotesP.length > 0 && <Progress value={pctProm} />}
                    {lotesP.length === 0 && <div style={{ fontSize: 12, color: C.g4, fontStyle: 'italic' }}>Sin lotes definidos</div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {vista === 'proyecto' && proySel && renderProyecto()}
      {vista === 'contrato' && contratoSel && renderContrato()}
    </div>
  )
}
