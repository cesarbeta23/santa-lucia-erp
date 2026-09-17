import { useState } from 'react'
import { C, Btn, Sel, Badge, Empty, SectionHeader, card, fmt, Progress, Modal } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

const TIPOS_INST = ['instalacion', 'todo_costo']

export default function Instalacion({ dbData, setDbData, toast, nav, irA, puedeEditar, verValorContrato = true }) {
  const {
    proyectos = [], contratos = [], items_contrato = [], constructoras = [],
    actas_facturacion = [], items_acta_facturacion = [],
    obras = [], elementos = [], mapa_items_instalacion = [],
  } = dbData
  const editable = puedeEditar ? puedeEditar('instalacion') : true

  const navContr = nav?.contratoId ? contratos.find(c => c.id === nav.contratoId) : null
  const navProy  = proyectos.find(p => p.id === (navContr?.proyecto_id || nav?.proyectoId)) || null

  const [vista, setVista]         = useState(navContr ? 'contrato' : navProy ? 'proyecto' : 'lista')
  const [proySel, setProySel]     = useState(navProy)
  const [contratoSel, setContrSel] = useState(navContr)
  const [tab, setTab]             = useState('avance')   // avance | aptos | mapa
  const [modalObra, setModalObra] = useState(false)
  const [obraForm, setObraForm]   = useState('')
  const [mapaItem, setMapaItem]   = useState(null)       // ítem al que se le están eligiendo elementos
  const [selEls, setSelEls]       = useState([])
  const [saving, setSaving]       = useState(false)

  // ── Helpers ───────────────────────────────────────────────
  const contratosInst = contratos.filter(c => TIPOS_INST.includes(c.tipo))
  const itemsDe   = cid => items_contrato.filter(i => i.contrato_id === cid).sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const obraDe    = proy => obras.find(o => o.id === proy?.obra_id) || null
  const elsDeItem = itemId => mapa_items_instalacion.filter(m => m.item_contrato_id === itemId).map(m => m.elemento_id)
  const nombreEl  = eid => elementos.find(e => e.id === eid)?.nombre || eid

  // Todos los apartamentos de la obra vinculada
  const aptosDe = obra => (obra?.pisos || []).flatMap(p =>
    (p.aptos || []).map(a => ({ ...a, pisoNombre: p.numero ?? p.nombre }))
  )

  // Cantidad instalada de un ítem en un apto: se cuenta solo cuando TODAS
  // sus partes están chuleadas (la constructora paga la unidad terminada).
  function instaladoEnApto(apto, itemId) {
    const eids = elsDeItem(itemId)
    if (!eids.length) return 0
    let min = Infinity
    for (const eid of eids) {
      const el = (apto.elementos || []).find(e => e.elementoId === eid)
      const cant = el?.completado ? Number(el.cantidad || 1) : 0
      min = Math.min(min, cant)
    }
    return min === Infinity ? 0 : min
  }

  const instaladoItem = (obra, itemId) =>
    aptosDe(obra).reduce((s, a) => s + instaladoEnApto(a, itemId), 0)

  // Cuántas partes de un ítem van chuleadas en un apto (para la vista por apto)
  function parcialEnApto(apto, itemId) {
    const eids = elsDeItem(itemId)
    const hechas = eids.filter(eid => (apto.elementos || []).find(e => e.elementoId === eid)?.completado).length
    return { hechas, total: eids.length }
  }

  const facturadoItem = itemId => items_acta_facturacion
    .filter(i => i.item_contrato_id === itemId)
    .reduce((s, i) => s + Number(i.cantidad || 0), 0)

  // ── Vincular obra de Gestión de Obras ─────────────────────
  async function guardarObra() {
    setSaving(true)
    try {
      const { data, error } = await supabase.from('proyectos')
        .update({ obra_id: obraForm || null }).eq('id', proySel.id).select().single()
      if (error) throw error
      setDbData(d => ({ ...d, proyectos: d.proyectos.map(p => p.id === data.id ? data : p) }))
      setProySel(data)
      toast(obraForm ? 'Obra vinculada' : 'Vínculo quitado', 'ok')
      setModalObra(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
  }

  // ── Guardar equivalencias de un ítem ──────────────────────
  function abrirMapa(item) {
    setMapaItem(item)
    setSelEls(elsDeItem(item.id))
  }

  async function guardarMapa() {
    setSaving(true)
    try {
      await supabase.from('mapa_items_instalacion').delete().eq('item_contrato_id', mapaItem.id)
      let nuevos = []
      if (selEls.length) {
        const rows = selEls.map(eid => ({ contrato_id: contratoSel.id, item_contrato_id: mapaItem.id, elemento_id: eid }))
        const { data, error } = await supabase.from('mapa_items_instalacion').insert(rows).select()
        if (error) throw error
        nuevos = data
      }
      setDbData(d => ({
        ...d,
        mapa_items_instalacion: [
          ...(d.mapa_items_instalacion || []).filter(m => m.item_contrato_id !== mapaItem.id),
          ...nuevos,
        ],
      }))
      toast('Equivalencias guardadas', 'ok')
      setMapaItem(null)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
  }

  // ── Vista lista de proyectos ──────────────────────────────
  if (vista === 'lista') {
    const proys = proyectos.filter(p => contratosInst.some(c => c.proyecto_id === p.id))
    return (
      <div>
        <SectionHeader title="🔧 Instalación" />
        {proys.length === 0 ? (
          <Empty icon="🔧" title="Sin contratos de instalación"
            desc="Los proyectos aparecen aquí cuando tienen un contrato de instalación o todo costo." />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {proys.map(p => {
              const cs    = contratosInst.filter(c => c.proyecto_id === p.id)
              const obra  = obraDe(p)
              const its   = cs.flatMap(c => itemsDe(c.id))
              const contr = its.reduce((s, i) => s + Number(i.cantidad || 0), 0)
              const inst  = obra ? its.reduce((s, i) => s + instaladoItem(obra, i.id), 0) : 0
              const pct   = contr > 0 ? Math.min(100, inst / contr * 100) : 0
              return (
                <div key={p.id} style={{ ...card, padding: '14px 18px', cursor: 'pointer' }}
                  onClick={() => { setProySel(p); setVista('proyecto') }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{p.nombre}</div>
                      <div style={{ fontSize: 12, color: C.g5 }}>
                        {constructoras.find(x => x.id === p.constructora_id)?.nombre} · {cs.length} contrato(s)
                      </div>
                    </div>
                    {obra
                      ? <Badge color="green">Obra vinculada</Badge>
                      : <Badge color="amber">Sin vincular</Badge>}
                  </div>
                  <Progress value={pct} />
                  <div style={{ fontSize: 11, color: C.g5, marginTop: 4 }}>
                    {Math.round(pct)}% instalado
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Vista proyecto ────────────────────────────────────────
  if (vista === 'proyecto') {
    const cs   = contratosInst.filter(c => c.proyecto_id === proySel?.id)
    const obra = obraDe(proySel)
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <Btn onClick={() => { setVista('lista'); setProySel(null) }}>← Instalación</Btn>
          {nav?.desde === 'proyecto' && irA && <Btn variant="primary" onClick={() => irA('proyectos', { proyectoId: nav.proyectoId })}>← Volver al proyecto</Btn>}
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>🔧 {proySel?.nombre}</h1>
        </div>

        <div style={{ ...card, padding: '12px 16px', marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em' }}>Obra en Gestión de Obras</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{obra ? obra.nombre : 'Sin vincular'}</div>
            {!obra && <div style={{ fontSize: 12, color: C.g5 }}>Sin vincular no se puede leer el avance de los coordinadores.</div>}
          </div>
          {editable && <Btn onClick={() => { setObraForm(proySel?.obra_id || ''); setModalObra(true) }}>
            {obra ? 'Cambiar obra' : 'Vincular obra'}
          </Btn>}
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {cs.map(c => {
            const its   = itemsDe(c.id)
            const contr = its.reduce((s, i) => s + Number(i.cantidad || 0), 0)
            const inst  = obra ? its.reduce((s, i) => s + instaladoItem(obra, i.id), 0) : 0
            const sinMapa = its.filter(i => elsDeItem(i.id).length === 0).length
            const pct   = contr > 0 ? Math.min(100, inst / contr * 100) : 0
            return (
              <div key={c.id} style={{ ...card, padding: '14px 18px', cursor: 'pointer' }}
                onClick={() => { setContrSel(c); setTab('avance'); setVista('contrato') }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {c.tipo === 'instalacion' ? '🔧 Instalación' : '📋 Todo Costo'}{c.numero ? ` #${c.numero}` : ''}
                    {verValorContrato && <span style={{ fontSize: 12, color: C.g5, marginLeft: 12 }}>{fmt(c.valor_total)}</span>}
                  </div>
                  {sinMapa > 0
                    ? <Badge color="amber">{sinMapa} ítem(s) sin equivalencias</Badge>
                    : <Badge color="green">Equivalencias listas</Badge>}
                </div>
                <Progress value={pct} />
                <div style={{ fontSize: 11, color: C.g5, marginTop: 4 }}>
                  {its.length} ítems · {Math.round(pct)}% instalado
                </div>
              </div>
            )
          })}
        </div>

        {modalObra && (
          <Modal title="Vincular obra de Gestión de Obras" onClose={() => setModalObra(false)}>
            <Sel label="Obra" value={obraForm} onChange={e => setObraForm(e.target.value)}>
              <option value="">— Sin vincular —</option>
              {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </Sel>
            <p style={{ fontSize: 12, color: C.g5, marginTop: 10 }}>
              Al vincular, el avance que los coordinadores chulean en Gestión de Obras se lee automáticamente acá.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <Btn onClick={() => setModalObra(false)}>Cancelar</Btn>
              <Btn variant="primary" onClick={guardarObra} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // ── Vista contrato ────────────────────────────────────────
  const its   = itemsDe(contratoSel.id)
  const obra  = obraDe(proySel)
  const aptos = aptosDe(obra)

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)} style={{
      padding: '8px 14px', border: 'none', borderRadius: 8, cursor: 'pointer',
      fontSize: 13, fontWeight: tab === k ? 700 : 500, fontFamily: 'inherit',
      background: tab === k ? C.bk : 'transparent', color: tab === k ? C.wh : C.g5,
    }}>{label}</button>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Btn onClick={() => { setVista('proyecto'); setContrSel(null) }}>← {proySel?.nombre}</Btn>
        {nav?.desde === 'proyecto' && irA && <Btn variant="primary" onClick={() => irA('proyectos', { proyectoId: nav.proyectoId })}>← Volver al proyecto</Btn>}
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
            🔧 {contratoSel.tipo === 'instalacion' ? 'Instalación' : 'Todo Costo'}{contratoSel.numero ? ` #${contratoSel.numero}` : ''}
          </h1>
          <div style={{ fontSize: 13, color: C.g5 }}>
            {proySel?.nombre}{obra ? ` · obra ${obra.nombre} · ${aptos.length} aptos` : ' · sin obra vinculada'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: C.g1, padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {tabBtn('avance', 'Avance por ítem')}
        {tabBtn('aptos', 'Por apartamento')}
        {tabBtn('mapa', 'Equivalencias')}
      </div>

      {!obra && (
        <div style={{ ...card, borderLeft: `4px solid ${C.am}`, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
          Este proyecto no tiene obra vinculada, así que el instalado sale en cero. Vinculala en la pantalla anterior.
        </div>
      )}

      {/* ── Avance por ítem ── */}
      {tab === 'avance' && (
        <div style={{ ...card, padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#1E3A5F' }}>
                {['REF', 'DESCRIPCIÓN', 'UM', 'CONTRATADO', 'INSTALADO', 'FACTURADO', 'FALTA INSTALAR', 'POR FACTURAR'].map((h, i) => (
                  <th key={h} style={{ padding: '9px 10px', textAlign: i < 3 ? 'left' : 'right', color: i < 3 ? '#BFDBFE' : '#93C5FD', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {its.map(it => {
                const contr = Number(it.cantidad || 0)
                const inst  = obra ? instaladoItem(obra, it.id) : 0
                const fact  = facturadoItem(it.id)
                const faltaInst = contr - inst
                const porFact   = inst - fact
                const sinMapa   = elsDeItem(it.id).length === 0
                return (
                  <tr key={it.id} style={{ borderTop: `1px solid ${C.g1}` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#1D4ED8', whiteSpace: 'nowrap' }}>{it.ref}</td>
                    <td style={{ padding: '8px 10px' }}>
                      {it.descripcion}
                      {sinMapa && <span style={{ fontSize: 11, color: C.or, marginLeft: 8 }}>⚠️ sin equivalencias</span>}
                    </td>
                    <td style={{ padding: '8px 10px', color: C.g5 }}>{it.unidad}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{contr.toLocaleString('es-CO')}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: inst > 0 ? C.gnD : C.g3 }}>{inst.toLocaleString('es-CO')}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: fact > 0 ? C.bk : C.g3 }}>{fact.toLocaleString('es-CO')}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700,
                      color: faltaInst === 0 ? C.gnD : faltaInst < 0 ? C.rd : C.or,
                      background: faltaInst === 0 ? '#DCFCE7' : faltaInst < 0 ? '#FEE2E2' : '#FFF7ED' }}>
                      {faltaInst === 0 ? '✓ Completo' : faltaInst < 0 ? `Exceso ${Math.abs(faltaInst).toLocaleString('es-CO')}` : faltaInst.toLocaleString('es-CO')}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: porFact > 0 ? C.or : C.g4 }}>
                      {porFact > 0 ? porFact.toLocaleString('es-CO') : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#1E3A5F', fontSize: 12, fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: '9px 10px', color: 'white' }}>TOTALES</td>
                {(() => {
                  const c = its.reduce((s, i) => s + Number(i.cantidad || 0), 0)
                  const i2 = obra ? its.reduce((s, i) => s + instaladoItem(obra, i.id), 0) : 0
                  const f = its.reduce((s, i) => s + facturadoItem(i.id), 0)
                  const cel = (v, col) => <td style={{ padding: '9px 10px', textAlign: 'right', color: col }}>{v.toLocaleString('es-CO')}</td>
                  return <>
                    {cel(c, 'white')}
                    {cel(i2, '#86EFAC')}
                    {cel(f, '#BFDBFE')}
                    {cel(c - i2, '#FDBA74')}
                    {cel(Math.max(0, i2 - f), '#FDBA74')}
                  </>
                })()}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Por apartamento ── */}
      {tab === 'aptos' && (
        aptos.length === 0
          ? <Empty icon="🏢" title="Sin apartamentos" desc="La obra vinculada no tiene pisos ni apartamentos creados." />
          : <div style={{ ...card, padding: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#1E3A5F' }}>
                    <th style={{ padding: '9px 10px', textAlign: 'left', color: '#BFDBFE', fontSize: 10, fontWeight: 700 }}>APTO</th>
                    {its.map(it => (
                      <th key={it.id} style={{ padding: '9px 8px', textAlign: 'center', color: '#93C5FD', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{it.ref}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aptos.map(a => (
                    <tr key={a.id} style={{ borderTop: `1px solid ${C.g1}` }}>
                      <td style={{ padding: '7px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {a.nombre || a.numero}
                        <span style={{ fontSize: 10, color: C.g5, marginLeft: 6 }}>P{a.pisoNombre}</span>
                      </td>
                      {its.map(it => {
                        const { hechas, total } = parcialEnApto(a, it.id)
                        const listo = total > 0 && hechas === total
                        return (
                          <td key={it.id} style={{ padding: '6px 8px', textAlign: 'center', borderLeft: `1px solid ${C.g1}`,
                            background: listo ? '#DCFCE7' : hechas > 0 ? '#FFF7ED' : undefined }}>
                            {total === 0 ? <span style={{ color: C.g3 }}>—</span>
                              : listo ? <span style={{ color: C.gnD, fontWeight: 700 }}>✓</span>
                              : <span style={{ color: hechas > 0 ? C.or : C.g4, fontSize: 11 }}>{hechas}/{total}</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
      )}

      {/* ── Equivalencias ── */}
      {tab === 'mapa' && (
        <div>
          <div style={{ ...card, padding: '12px 16px', marginBottom: 14, fontSize: 13, color: C.g5 }}>
            Cada ítem del contrato se arma con los elementos que se chulean en Gestión de Obras.
            Ejemplo: "Puerta WC social" = Puerta Wc Social + CHAPA + TOPE RESORTE.
            El ítem cuenta como instalado en un apartamento solo cuando todas sus partes están chuleadas.
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {its.map(it => {
              const eids = elsDeItem(it.id)
              return (
                <div key={it.id} style={{ ...card, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      <span style={{ color: '#1D4ED8' }}>{it.ref}</span> · {it.descripcion}
                    </div>
                    <div style={{ fontSize: 12, color: eids.length ? C.g5 : C.or, marginTop: 3 }}>
                      {eids.length ? eids.map(nombreEl).join('  +  ') : 'Sin equivalencias definidas'}
                    </div>
                  </div>
                  {editable && <Btn size="sm" onClick={() => abrirMapa(it)}>{eids.length ? 'Cambiar' : 'Definir'}</Btn>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal equivalencias */}
      {mapaItem && (
        <Modal title={`Elementos de: ${mapaItem.descripcion}`} onClose={() => setMapaItem(null)} wide>
          <p style={{ fontSize: 13, color: C.g5, marginBottom: 12 }}>
            Marcá los elementos de Gestión de Obras que forman este ítem.
          </p>
          <div style={{ maxHeight: 360, overflow: 'auto', display: 'grid', gap: 4 }}>
            {elementos.length === 0 && <div style={{ fontSize: 13, color: C.g5 }}>No hay elementos cargados.</div>}
            {elementos.map(el => {
              const marcado = selEls.includes(el.id)
              return (
                <label key={el.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: marcado ? '#EFF6FF' : C.g0, border: `1px solid ${marcado ? '#BFDBFE' : C.g1}` }}>
                  <input type="checkbox" checked={marcado}
                    onChange={e => setSelEls(s => e.target.checked ? [...s, el.id] : s.filter(x => x !== el.id))} />
                  <span style={{ fontWeight: marcado ? 600 : 400 }}>{el.nombre}</span>
                </label>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <Btn onClick={() => setMapaItem(null)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardarMapa} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
