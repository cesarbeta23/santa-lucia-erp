import { useState } from 'react'
import { C, Btn, Sel, Badge, Empty, SectionHeader, card, fmt, Progress, Modal, Stat } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

const TIPOS_INST = ['instalacion', 'todo_costo']

export default function Instalacion({ dbData, setDbData, toast, nav, irA, puedeEditar, verValorContrato = true }) {
  const {
    proyectos = [], contratos = [], items_contrato = [], constructoras = [],
    actas_facturacion = [], items_acta_facturacion = [],
    obras = [], elementos = [], subitems_instalacion = [],
    liquidaciones = [], usuarios = [],
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
  const [partesItem, setPartesItem] = useState(null)     // ítem al que se le están armando las partes
  const [partesTmp, setPartesTmp]   = useState([])
  const [saving, setSaving]       = useState(false)
  const [corteDet, setCorteDet]   = useState(null)      // corte abierto en el detalle de pagos

  // ── Helpers ───────────────────────────────────────────────
  const contratosInst = contratos.filter(c => TIPOS_INST.includes(c.tipo))
  const itemsDe   = cid => items_contrato.filter(i => i.contrato_id === cid).sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const obraDe    = proy => obras.find(o => o.id === proy?.obra_id) || null
  const partesDe  = itemId => subitems_instalacion.filter(p => p.item_contrato_id === itemId).sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const elsDeItem = itemId => [...new Set(partesDe(itemId).filter(p => p.elemento_id).map(p => p.elemento_id))]
  const nombreEl  = eid => elementos.find(e => e.id === eid)?.nombre || eid

  // Un elemento solo puede pertenecer a un ítem del contrato.
  // Devuelve el ítem que ya lo tiene (si es otro distinto al que se está editando).

  // Todos los apartamentos de la obra vinculada
  const aptosDe = obra => (obra?.pisos || []).flatMap(p =>
    (p.aptos || []).map(a => ({ ...a, pisoNombre: p.numero ?? p.nombre }))
  )

  // Cantidad instalada de un ítem en un apto: se cuenta solo cuando TODAS
  // sus partes están chuleadas (la constructora paga la unidad terminada).
  // Cuenta los elementos del apto y los de sus tipologías extra
  const elsDelApto = apto => [...(apto.elementos || []), ...(apto.elementosExtra || [])]

  function instaladoEnApto(apto, itemId) {
    const eids = elsDeItem(itemId)
    if (!eids.length) return 0
    const todos = elsDelApto(apto)
    let min = Infinity
    for (const eid of eids) {
      // si el elemento está repetido (tipología extra), se toma lo que sume completado
      const cant = todos.filter(e => e.elementoId === eid && e.completado)
        .reduce((s, e) => s + Number(e.cantidad || 1), 0)
      min = Math.min(min, cant)
    }
    return min === Infinity ? 0 : min
  }

  const instaladoItem = (obra, itemId) =>
    aptosDe(obra).reduce((s, a) => s + instaladoEnApto(a, itemId), 0)

  // Cuántas partes de un ítem van chuleadas en un apto (para la vista por apto)
  function parcialEnApto(apto, itemId) {
    const eids = elsDeItem(itemId)
    const todos = elsDelApto(apto)
    const hechas = eids.filter(eid => todos.some(e => e.elementoId === eid && e.completado)).length
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


  // ── Partes del ítem (lo que se paga a la gente) ───────────
  function abrirPartes(item) {
    const ps = partesDe(item.id)
    setPartesItem(item)
    setPartesTmp(ps.length
      ? ps.map(p => ({ id: p.id, nombre: p.nombre, unidad: p.unidad || 'und', valor_instalador: p.valor_instalador || 0, valor_detallado: p.valor_detallado || 0, elemento_id: p.elemento_id }))
      : [{ nombre: item.descripcion, unidad: item.unidad || 'und', valor_instalador: '', valor_detallado: '' }])
  }

  // Elementos que se pueden enlazar: los de esta obra y los generales de siempre
  const elsObra = elementos
    .filter(el => el.activo !== false && (!el.obra_id || el.obra_id === proySel?.obra_id))
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))

  async function guardarPartes() {
    setSaving(true)
    try {
      const filas = partesTmp.filter(p => p.nombre?.trim())
      await supabase.from('subitems_instalacion').delete().eq('item_contrato_id', partesItem.id)
      let nuevas = []
      if (filas.length) {
        const rows = filas.map((p, i) => ({
          item_contrato_id: partesItem.id, nombre: p.nombre.trim(), unidad: p.unidad || 'und',
          valor_instalador: Number(p.valor_instalador) || 0, valor_detallado: Number(p.valor_detallado) || 0,
          elemento_id: p.elemento_id || null, orden: i,   // vacío = se crea al enviar a la obra
        }))
        const { data, error } = await supabase.from('subitems_instalacion').insert(rows).select()
        if (error) throw error
        nuevas = data
      }
      setDbData(d => ({
        ...d,
        subitems_instalacion: [
          ...(d.subitems_instalacion || []).filter(p => p.item_contrato_id !== partesItem.id),
          ...nuevas,
        ],
      }))
      toast('Partes guardadas', 'ok')
      setPartesItem(null)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
  }

  // Crea en Gestión de Obras los elementos de esta obra que todavía no existen
  async function enviarALaObra() {
    if (!obraDe(proySel)) { toast('Primero vinculá la obra', 'err'); return }
    const pendientes = its.flatMap(it => partesDe(it.id).filter(p => !p.elemento_id).map(p => ({ p, it })))
    if (!pendientes.length) { toast('Todas las partes ya están en la obra', 'info'); return }
    setSaving(true)
    try {
      const nuevosEls = [], actualizadas = []
      for (const { p, it } of pendientes) {
        const el = {
          id: `e${Date.now()}${Math.floor(Math.random() * 1000)}`,
          nombre: p.nombre, unidad: p.unidad || 'und',
          precio: Number(p.valor_instalador) || 0,
          precio_detallado: Number(p.valor_detallado) || 0,
          grupo: it.ref || 'Contrato', activo: true,
          obra_id: proySel.obra_id, item_contrato_id: it.id,
        }
        const { data: elCreado, error: e1 } = await supabase.from('elementos').insert(el).select().single()
        if (e1) throw e1
        nuevosEls.push(elCreado)
        const { data: sub, error: e2 } = await supabase.from('subitems_instalacion')
          .update({ elemento_id: elCreado.id }).eq('id', p.id).select().single()
        if (e2) throw e2
        actualizadas.push(sub)
      }
      setDbData(d => ({
        ...d,
        elementos: [...d.elementos, ...nuevosEls],
        subitems_instalacion: d.subitems_instalacion.map(x => actualizadas.find(a => a.id === x.id) || x),
      }))
      toast(`${nuevosEls.length} elemento(s) creados en la obra`, 'ok')
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
  }

  // ── Lo pagado a instaladores y detalladores en esta obra ──
  // Las liquidaciones se cierran por persona y corte, y pueden tocar varias obras:
  // el valor de instalación se separa por obra, pero la retención, los pasajes
  // y la bonificación son de la persona en ese corte, no de una obra en particular.
  const esDetallado = r => String(r.actividad || '') === 'Detallado' || String(r.el || '').startsWith('[Detallado]')
  const esAdicional = r => String(r.el || '').startsWith('[Adicional]')

  function pagosDeObra(obra) {
    if (!obra) return []
    const cortes = {}
    for (const l of liquidaciones) {
      const filas = (l.rows || []).filter(r => (r.obra || '') === obra.nombre)
      if (!filas.length) continue
      const val = fs => fs.reduce((s, r) => s + Number(r.precio || 0) * Number(r.cant || 1), 0)
      const c = cortes[l.corte] || (cortes[l.corte] = { corte: l.corte, inst: 0, det: 0, adic: 0, personas: [] })
      const inst = val(filas.filter(r => !esDetallado(r) && !esAdicional(r)))
      const det  = val(filas.filter(esDetallado))
      const adic = val(filas.filter(esAdicional))
      c.inst += inst; c.det += det; c.adic += adic
      c.personas.push({
        id: l.inst_id, nombre: l.inst_nombre, inst, det, adic,
        ret: Number(l.ret || 0), pas: Number(l.pas || 0), bon: Number(l.bon || 0),
        total: Number(l.total || 0), soloEstaObra: filas.length === (l.rows || []).length,
      })
    }
    return Object.values(cortes).sort((a, b) => String(b.corte).localeCompare(String(a.corte)))
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
                    ? <Badge color="amber">{sinMapa} ítem(s) sin desglosar</Badge>
                    : <Badge color="green">Desglose listo</Badge>}
                </div>
                <Progress value={pct} />
                <div style={{ fontSize: 11, color: C.g5, marginTop: 4 }}>
                  {its.length} ítems · {Math.round(pct)}% instalado
                </div>
              </div>
            )
          })}
        </div>

        {(() => {
          const pagos = pagosDeObra(obra)
          if (!obra || !verValorContrato) return null
          const tot = pagos.reduce((a, c) => ({ inst: a.inst + c.inst, det: a.det + c.det, adic: a.adic + c.adic }), { inst: 0, det: 0, adic: 0 })
          return (
            <div style={{ marginTop: 22 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                💵 Pagado en instalación
              </h3>
              {pagos.length === 0 ? (
                <div style={{ ...card, padding: '14px 18px', fontSize: 13, color: C.g5 }}>
                  Todavía no hay cortes cerrados de esta obra.
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 12 }}>
                    <Stat label="Instalación" value={fmt(tot.inst)} />
                    <Stat label="Detallado"   value={fmt(tot.det)} />
                    <Stat label="Adicionales" value={fmt(tot.adic)} color={C.am} />
                    <Stat label="Total pagado" value={fmt(tot.inst + tot.det + tot.adic)} color={C.or} sub={`${pagos.length} corte(s)`} />
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {pagos.map(c => (
                      <div key={c.corte} style={{ ...card, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                        onClick={() => setCorteDet(c)}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.corte} ›</div>
                          <div style={{ fontSize: 11, color: C.g5 }}>
                            {c.personas.length} persona(s) · instalación {fmt(c.inst)}{c.det ? ` · detallado ${fmt(c.det)}` : ''}{c.adic ? ` · adicionales ${fmt(c.adic)}` : ''}
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(c.inst + c.det + c.adic)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })()}

        {corteDet && (
          <Modal title={`Pagos del corte ${corteDet.corte}`} onClose={() => setCorteDet(null)} wide>
            <div style={{ ...card, padding: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.g1 }}>
                    {['PERSONA', 'INSTALACIÓN', 'DETALLADO', 'ADICIONALES', 'RETENIDO 10%', 'PASAJES', 'BONIFICACIÓN', 'PAGADO'].map((h, i) => (
                      <th key={h} style={{ padding: '7px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: 10, fontWeight: 700, color: C.g5, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {corteDet.personas.map((p, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.g1}` }}>
                      <td style={{ padding: '7px 10px', fontWeight: 600 }}>
                        {p.nombre}
                        {!p.soloEstaObra && <span style={{ fontSize: 10, color: C.or, marginLeft: 6 }}>trabajó en más obras</span>}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmt(p.inst)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{p.det ? fmt(p.det) : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{p.adic ? fmt(p.adic) : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: C.rd }}>{fmt(p.ret)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{p.pas ? fmt(p.pas) : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{p.bon ? fmt(p.bon) : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>{fmt(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: C.g5, marginTop: 12 }}>
              Instalación, detallado y adicionales son solo de esta obra.
              El retenido, los pasajes, la bonificación y el pagado son del corte completo de esa persona:
              si trabajó en varias obras, ese valor incluye las demás.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <Btn onClick={() => setCorteDet(null)}>Cerrar</Btn>
            </div>
          </Modal>
        )}

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
        {tabBtn('partes', 'Partes y pagos')}
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

      {/* ── Partes y pagos ── */}
      {tab === 'partes' && (
        <div>
          <div style={{ ...card, padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: C.g5, flex: 1, minWidth: 260 }}>
              Cada ítem del contrato se desglosa en las partes que se le pagan a la gente.
              En obras nuevas, al enviarlas se crean como elementos <strong>de esta obra</strong> en Gestión de Obras.
              En obras que ya están montadas, enlazá cada parte con el elemento que ya existe, para no dañar los cortes hechos.
              De cualquier forma quedan amarradas a su ítem: cuando estén todas chuleadas en un apto, cuenta una unidad instalada.
            </div>
            {editable && <div style={{ textAlign: 'right' }}>
              <Btn variant="primary" onClick={enviarALaObra} disabled={saving || !obra}>
                {saving ? 'Enviando…' : '→ Crear en la obra las que falten'}
              </Btn>
              <div style={{ fontSize: 11, color: C.g5, marginTop: 4, maxWidth: 220 }}>
                {obra ? 'Solo crea las partes que no estén enlazadas todavía.' : 'Primero vinculá la obra.'}
              </div>
            </div>}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {its.map(it => {
              const ps = partesDe(it.id)
              const enObra = ps.filter(p => p.elemento_id).length
              const totInst = ps.reduce((s, p) => s + Number(p.valor_instalador || 0), 0)
              const totDet  = ps.reduce((s, p) => s + Number(p.valor_detallado || 0), 0)
              return (
                <div key={it.id} style={{ ...card, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: ps.length ? 8 : 0 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        <span style={{ color: '#1D4ED8' }}>{it.ref}</span> · {it.descripcion}
                      </div>
                      <div style={{ fontSize: 12, color: ps.length ? C.g5 : C.or, marginTop: 3 }}>
                        {ps.length
                          ? `${ps.length} parte(s) · ${enObra} en la obra · paga ${fmt(totInst)} instalación + ${fmt(totDet)} detallado`
                          : 'Sin desglosar'}
                      </div>
                    </div>
                    {verValorContrato && <div style={{ textAlign: 'right', minWidth: 110 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(it.vr_unitario)}</div>
                      <div style={{ fontSize: 10, color: C.g4 }}>cobra x unidad</div>
                    </div>}
                    {editable && <Btn size="sm" onClick={() => abrirPartes(it)}>{ps.length ? 'Editar partes' : 'Desglosar'}</Btn>}
                  </div>
                  {ps.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {ps.map(p => (
                        <span key={p.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: p.elemento_id ? '#DCFCE7' : C.g1, color: p.elemento_id ? C.gnD : C.g5, border: `1px solid ${p.elemento_id ? '#BBF7D0' : C.g2}` }}>
                          {p.elemento_id ? '✓ ' : ''}{p.nombre} · {fmt(p.valor_instalador)}{Number(p.valor_detallado) ? ` + ${fmt(p.valor_detallado)}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal partes */}
      {partesItem && (
        <Modal title={`Partes de: ${partesItem.descripcion}`} onClose={() => setPartesItem(null)} wide>
          <p style={{ fontSize: 13, color: C.g5, marginBottom: 12 }}>
            Los valores son lo que se le paga a la gente por cada parte.
            Si la obra ya está montada, enlazá cada parte con el elemento que ya existe en Gestión de Obras;
            así no se crean repetidos y los cortes viejos quedan intactos.
          </p>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px 1fr 32px', gap: 8, fontSize: 10, fontWeight: 700, color: C.g5, textTransform: 'uppercase' }}>
              <span>Parte</span><span>UM</span><span>Instalación</span><span>Detallado</span><span>Elemento en la obra</span><span />
            </div>
            {partesTmp.map((p, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px 1fr 32px', gap: 8, alignItems: 'center' }}>
                <input value={p.nombre} disabled={!!p.elemento_id}
                  onChange={e => setPartesTmp(t => t.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))}
                  placeholder="Ej: Ala y marco"
                  style={{ padding: '7px 10px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 13, background: p.elemento_id ? C.g0 : 'white' }} />
                <input value={p.unidad}
                  onChange={e => setPartesTmp(t => t.map((x, j) => j === i ? { ...x, unidad: e.target.value } : x))}
                  style={{ padding: '7px 8px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 13 }} />
                <input type="number" min="0" value={p.valor_instalador}
                  onChange={e => setPartesTmp(t => t.map((x, j) => j === i ? { ...x, valor_instalador: e.target.value } : x))}
                  style={{ padding: '7px 8px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 13, textAlign: 'right' }} />
                <input type="number" min="0" value={p.valor_detallado}
                  onChange={e => setPartesTmp(t => t.map((x, j) => j === i ? { ...x, valor_detallado: e.target.value } : x))}
                  style={{ padding: '7px 8px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 13, textAlign: 'right' }} />
                <select value={p.elemento_id || ''}
                  onChange={e => setPartesTmp(t => t.map((x, j) => j === i ? { ...x, elemento_id: e.target.value || null } : x))}
                  style={{ padding: '7px 8px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 12 }}>
                  <option value="">— crear nuevo al enviar —</option>
                  {elsObra.map(el => <option key={el.id} value={el.id}>{el.nombre}</option>)}
                </select>
                <Btn size="sm" variant="danger" onClick={() => setPartesTmp(t => t.filter((_, j) => j !== i))}>✕</Btn>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <Btn size="sm" onClick={() => setPartesTmp(t => [...t, { nombre: '', unidad: 'und', valor_instalador: '', valor_detallado: '' }])}>+ Agregar parte</Btn>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: C.g5 }}>
            Total que se paga por unidad: <strong>{fmt(partesTmp.reduce((s, p) => s + (Number(p.valor_instalador) || 0) + (Number(p.valor_detallado) || 0), 0))}</strong>
            {verValorContrato && partesItem.vr_unitario ? ` · se cobra ${fmt(partesItem.vr_unitario)}` : ''}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <Btn onClick={() => setPartesItem(null)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardarPartes} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
          </div>
        </Modal>
      )}

    </div>
  )
}
