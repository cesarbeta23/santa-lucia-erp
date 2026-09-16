import { useState } from 'react'
import { C, Btn, Inp, Sel, Txt, Modal, Badge, Empty, SectionHeader, card, fmt, fmtDate, Progress, Stat } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

const emptyForm = { nombre: '', constructora_id: '', estado: 'activo', fecha_inicio: '', fecha_fin: '', notas: '' }
const ESTADOS = {
  activo:    { label: 'Activo',    color: 'green' },
  pausado:   { label: 'Pausado',   color: 'amber' },
  terminado: { label: 'Terminado', color: 'gray'  },
}
const ROL_FINANCIERO = ['superadmin', 'supervisor', 'auxiliar']

export default function Proyectos({ dbData, setDbData, toast, user }) {
  const {
    proyectos = [], constructoras = [], contratos = [],
    items_contrato = [], actas_facturacion = [],
    pedidos = [], items_pedido = [], items_despacho = [],
    adicionales = [],
  } = dbData

  const [vista, setVista]         = useState('lista')
  const [proySel, setProySel]     = useState(null)
  const [modal, setModal]         = useState(false)
  const [form, setForm]           = useState(emptyForm)
  const [editId, setEditId]       = useState(null)
  const [delId, setDelId]         = useState(null)
  const [search, setSearch]       = useState('')
  const [filtConst, setFiltConst] = useState('')
  const [filtEst, setFiltEst]     = useState('')

  const verFinanzas = ROL_FINANCIERO.includes(user?.rol)

  const totalFacturado = cid =>
    actas_facturacion.filter(a => a.contrato_id === cid).reduce((s, a) => s + (Number(a.total) || 0), 0)

  const cantRecibida = itemId =>
    (items_despacho || []).filter(d => d.item_pedido_id === itemId).reduce((s, d) => s + (Number(d.cantidad) || 0), 0)

  const filtered = proyectos.filter(p => {
    const c = constructoras.find(x => x.id === p.constructora_id)
    return (
      (!search || p.nombre?.toLowerCase().includes(search.toLowerCase()) || c?.nombre?.toLowerCase().includes(search.toLowerCase())) &&
      (!filtConst || p.constructora_id === filtConst) &&
      (!filtEst   || p.estado === filtEst)
    )
  }).sort((a, b) => a.nombre.localeCompare(b.nombre))

  function openNew()   { setForm(emptyForm); setEditId(null); setModal(true) }
  function openEdit(p) { setForm({ ...p }); setEditId(p.id); setModal(true) }

  async function guardar() {
    if (!form.nombre)          { toast('El nombre es obligatorio', 'err'); return }
    if (!form.constructora_id) { toast('Selecciona la constructora', 'err'); return }
    try {
      if (editId) {
        const { data, error } = await supabase.from('proyectos').update(form).eq('id', editId).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, proyectos: d.proyectos.map(p => p.id === editId ? data : p) }))
        if (proySel?.id === editId) setProySel(data)
        toast('Proyecto actualizado', 'ok')
      } else {
        const { data, error } = await supabase.from('proyectos').insert(form).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, proyectos: [...d.proyectos, data] }))
        toast('Proyecto creado', 'ok')
      }
      setModal(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  async function eliminar() {
    try {
      const { error } = await supabase.from('proyectos').delete().eq('id', delId)
      if (error) throw error
      setDbData(d => ({ ...d, proyectos: d.proyectos.filter(p => p.id !== delId) }))
      toast('Proyecto eliminado', 'ok')
      setDelId(null)
      setVista('lista')
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  // ── Dashboard data ────────────────────────────────────────
  const contrProy  = contratos.filter(c => c.proyecto_id === proySel?.id)
  const pedProy    = pedidos.filter(p => p.proyecto_id === proySel?.id)
  const adProy     = adicionales.filter(a => a.proyecto_id === proySel?.id)
  const constru    = constructoras.find(c => c.id === proySel?.constructora_id)
  const estSel     = ESTADOS[proySel?.estado] || ESTADOS.activo
  const totalContratos = contrProy.reduce((s, c) => s + (Number(c.valor_total) || 0), 0)
  const totalFact      = contrProy.reduce((s, c) => s + totalFacturado(c.id), 0)
  const pctFact        = totalContratos > 0 ? (totalFact / totalContratos) * 100 : 0
  const itemsPed       = pedProy.flatMap(p => items_pedido.filter(i => i.pedido_id === p.id))
  const totalPedido    = itemsPed.reduce((s, i) => s + Number(i.cantidad_pedida || 0), 0)
  const totalRecibido  = itemsPed.reduce((s, i) => s + cantRecibida(i.id), 0)
  const pctPed         = totalPedido > 0 ? (totalRecibido / totalPedido) * 100 : 0
  const adPend         = adProy.filter(a => a.estado === 'pendiente').length
  const adCobrar       = adProy.filter(a => a.cobrar_a_obra && !a.aprobado).length

  // ── Render ────────────────────────────────────────────────
  return (
    <div>

      {/* ── DASHBOARD ── */}
      {vista === 'dashboard' && proySel && (
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 24 }}>
            <Btn onClick={() => setVista('lista')}>← Proyectos</Btn>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{proySel.nombre}</h1>
                <Badge color={estSel.color}>{estSel.label}</Badge>
              </div>
              <div style={{ fontSize: 13, color: C.g5, marginTop: 4 }}>
                🏢 {constru?.nombre}
                {proySel.fecha_inicio && ` · Inicio: ${fmtDate(proySel.fecha_inicio)}`}
                {proySel.fecha_fin    && ` · Entrega: ${fmtDate(proySel.fecha_fin)}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={() => openEdit(proySel)}>Editar</Btn>
              <Btn variant="danger" onClick={() => setDelId(proySel.id)}>Eliminar</Btn>
            </div>
          </div>

          {verFinanzas && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
              <Stat label="Total contratos"  value={fmt(totalContratos)} />
              <Stat label="Facturado"        value={fmt(totalFact)} color={C.gnD} sub={`${Math.round(pctFact)}% del total`} />
              <Stat label="Por facturar"     value={fmt(totalContratos - totalFact)} color={C.am} />
              <Stat label="Adicionales"      value={adPend + adCobrar} color={adPend > 0 ? C.rd : C.gnD}
                sub={adPend > 0 ? `${adPend} pendiente(s)` : 'Al día'} />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {verFinanzas && (
              <div>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em' }}>📄 Contratos</h3>
                {contrProy.length === 0 ? (
                  <div style={{ ...card, textAlign: 'center', color: C.g4, padding: '1.5rem', fontSize: 13 }}>Sin contratos</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {contrProy.map(c => {
                      const pct = totalContratos > 0 ? (totalFacturado(c.id) / Number(c.valor_total || 1)) * 100 : 0
                      const tipo = c.tipo === 'suministro' ? '📦' : c.tipo === 'instalacion' ? '🔧' : '📋'
                      const label = c.tipo === 'suministro' ? 'Suministro' : c.tipo === 'instalacion' ? 'Instalación' : 'Todo Costo'
                      return (
                        <div key={c.id} style={{ ...card, padding: '12px 16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700 }}>{tipo} {label}{c.numero ? ` #${c.numero}` : ''}</span>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{fmt(c.valor_total)}</div>
                              <div style={{ fontSize: 11, color: C.gnD }}>{fmt(totalFacturado(c.id))} facturado</div>
                            </div>
                          </div>
                          <Progress value={pct} />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em' }}>📦 Materiales</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ ...card, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Pedido</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{totalPedido.toLocaleString('es-CO')}</div>
                </div>
                <div style={{ ...card, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Recibido</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.gnD }}>{totalRecibido.toLocaleString('es-CO')}</div>
                </div>
                <div style={{ ...card, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Pendiente</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.am }}>{(totalPedido - totalRecibido).toLocaleString('es-CO')}</div>
                </div>
              </div>
              <Progress value={pctPed} />
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pedProy.map(p => {
                  const its = items_pedido.filter(i => i.pedido_id === p.id)
                  const rec = its.reduce((s,i) => s + cantRecibida(i.id), 0)
                  const ped2 = its.reduce((s,i) => s + Number(i.cantidad_pedida||0), 0)
                  const pct2 = ped2 > 0 ? (rec/ped2)*100 : 0
                  return (
                    <div key={p.id} style={{ ...card, padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{p.proveedor || 'Sin proveedor'}</span>
                          {p.numero && <span style={{ fontSize: 12, color: C.g4, marginLeft: 8 }}>#{p.numero}</span>}
                        </div>
                        {verFinanzas && (
                          <div style={{ fontSize: 13, fontWeight: 600, color: C.gnD }}>
                            {fmt(its.reduce((s,i) => s + Number(i.cantidad_pedida||0)*Number(i.vr_unitario||0),0) * 1.19)}
                          </div>
                        )}
                      </div>
                      <Progress value={pct2} />
                      <div style={{ fontSize: 11, color: C.g5, marginTop: 4 }}>
                        {rec.toLocaleString('es-CO')} / {ped2.toLocaleString('es-CO')} und
                      </div>
                    </div>
                  )
                })}
                {pedProy.length === 0 && <div style={{ ...card, textAlign: 'center', color: C.g4, padding: '1.5rem', fontSize: 13 }}>Sin pedidos</div>}
              </div>
            </div>

            {verFinanzas && adProy.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em' }}>➕ Adicionales</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {adProy.slice(0, 5).map(a => (
                    <div key={a.id} style={{ ...card, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{a.descripcion}</div>
                        <div style={{ fontSize: 11, color: C.g5 }}>
                          {a.origen === 'obra' ? '🏗️ Por obra' : '🔧 Por instalador'}
                          {a.cobrar_a_obra ? ' · Por cobrar' : ' · Interno'}
                        </div>
                      </div>
                      <Badge color={a.estado === 'aprobado' ? 'green' : a.estado === 'rechazado' ? 'red' : 'amber'}>{a.estado}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {verFinanzas && (
              <div>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em' }}>🧾 Últimas actas</h3>
                {(() => {
                  const actas = actas_facturacion.filter(a => contrProy.some(c => c.id === a.contrato_id))
                    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5)
                  return actas.length === 0 ? (
                    <div style={{ ...card, textAlign: 'center', color: C.g4, padding: '1.5rem', fontSize: 13 }}>Sin actas</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {actas.map(a => {
                        const c = contrProy.find(x => x.id === a.contrato_id)
                        return (
                          <div key={a.id} style={{ ...card, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>
                                {c?.tipo === 'suministro' ? '📦' : '🔧'} Acta {a.numero_acta || '—'}
                              </div>
                              <div style={{ fontSize: 11, color: C.g5 }}>{fmtDate(a.fecha)}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: C.gnD }}>{fmt(a.total)}</div>
                              <Badge color={a.estado === 'pagada' ? 'green' : a.estado === 'facturada' ? 'blue' : 'amber'}>{a.estado}</Badge>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LISTA ── */}
      {vista === 'lista' && (
        <div>
          <SectionHeader title="Proyectos">
            <Btn variant="primary" onClick={openNew}>+ Nuevo proyecto</Btn>
          </SectionHeader>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <input placeholder="Buscar proyecto…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, outline: 'none', width: 220 }} />
            <select value={filtConst} onChange={e => setFiltConst(e.target.value)}
              style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
              <option value="">Todas las constructoras</option>
              {constructoras.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select value={filtEst} onChange={e => setFiltEst(e.target.value)}
              style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            {Object.entries(ESTADOS).map(([k,v]) => (
              <div key={k} style={{ ...card, padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <Badge color={v.color}>{v.label}</Badge>
                <span style={{ fontWeight: 700, fontSize: 18 }}>{proyectos.filter(p => p.estado === k).length}</span>
              </div>
            ))}
          </div>

          {filtered.length === 0 ? (
            <Empty icon="🏗️" title="Sin proyectos" desc="Crea el primer proyecto."
              action={<Btn variant="primary" onClick={openNew}>+ Nuevo proyecto</Btn>} />
          ) : (
            <div>
              {constructoras.map(constr => {
                const pList = filtered.filter(p => p.constructora_id === constr.id)
                if (!pList.length) return null
                return (
                  <div key={constr.id} style={{ marginBottom: 28 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${C.g2}` }}>
                      <span style={{ fontSize: 18 }}>🏢</span>
                      <span style={{ fontWeight: 800, fontSize: 16 }}>{constr.nombre}</span>
                      <span style={{ fontSize: 12, color: C.g5 }}>{pList.length} proyecto(s)</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                      {pList.map(p => {
                        const est = ESTADOS[p.estado] || ESTADOS.activo
                        const cP = contratos.filter(c => c.proyecto_id === p.id)
                        const tF = cP.reduce((s, c) => s + totalFacturado(c.id), 0)
                        const tC = cP.reduce((s, c) => s + (Number(c.valor_total)||0), 0)
                        const pct = tC > 0 ? (tF/tC)*100 : 0
                        return (
                          <div key={p.id} style={{
                            ...card, cursor: 'pointer',
                            borderLeft: `4px solid ${p.estado==='activo'?C.or:p.estado==='pausado'?C.am:C.g3}`,
                          }}
                            onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.1)'}
                            onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.06)'}
                            onClick={() => { setProySel(p); setVista('dashboard') }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                              <div style={{ fontWeight: 700, fontSize: 15 }}>{p.nombre}</div>
                              <Badge color={est.color}>{est.label}</Badge>
                            </div>
                            <div style={{ fontSize: 12, color: C.g5, display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                              <span>📄 {cP.length} contrato(s)</span>
                              <span>📦 {pedidos.filter(x => x.proyecto_id === p.id).length} pedido(s)</span>
                              {p.fecha_inicio && <span>📅 {fmtDate(p.fecha_inicio)}</span>}
                            </div>
                            {verFinanzas && tC > 0 && (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                  <span style={{ color: C.g5 }}>{fmt(tC)}</span>
                                  <span style={{ color: C.gnD, fontWeight: 600 }}>{Math.round(pct)}% facturado</span>
                                </div>
                                <Progress value={pct} />
                              </div>
                            )}
                            {p.notas && <div style={{ fontSize: 11, color: C.g4, marginTop: 8, fontStyle: 'italic' }}>{p.notas}</div>}
                            <div style={{ display: 'flex', gap: 6, marginTop: 10 }} onClick={e => e.stopPropagation()}>
                              <Btn size="sm" onClick={() => openEdit(p)}>Editar</Btn>
                              <Btn size="sm" variant="danger" onClick={() => setDelId(p.id)}>Eliminar</Btn>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {filtered.filter(p => !p.constructora_id).map(p => (
                <div key={p.id} style={{ ...card, cursor: 'pointer', marginBottom: 8 }}
                  onClick={() => { setProySel(p); setVista('dashboard') }}>
                  <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODALES (siempre disponibles) ── */}
      {modal && (
        <Modal title={editId ? 'Editar proyecto' : 'Nuevo proyecto'} onClose={() => setModal(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Inp label="Nombre *" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Verde Silvestre…" />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <Sel label="Constructora *" value={form.constructora_id} onChange={e => setForm(f => ({ ...f, constructora_id: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                {constructoras.filter(c => c.activa).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </Sel>
            </div>
            <Sel label="Estado" value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
              {Object.entries(ESTADOS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </Sel>
            <div />
            <Inp label="Fecha inicio" type="date" value={form.fecha_inicio||''} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
            <Inp label="Fecha entrega" type="date" value={form.fecha_fin||''} onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value }))} />
            <div style={{ gridColumn: '1/-1' }}>
              <Txt label="Notas" value={form.notas||''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <Btn onClick={() => setModal(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardar}>{editId ? 'Guardar' : 'Crear proyecto'}</Btn>
          </div>
        </Modal>
      )}

      {delId && (
        <Modal title="Eliminar proyecto" onClose={() => setDelId(null)}>
          <p style={{ fontSize: 14, marginBottom: 8 }}>¿Eliminar <strong>{proyectos.find(p => p.id === delId)?.nombre}</strong>?</p>
          <p style={{ fontSize: 13, color: C.rd, marginBottom: 20 }}>Se eliminarán todos los contratos, pedidos y actas asociadas.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Btn onClick={() => setDelId(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={eliminar}>Sí, eliminar</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
