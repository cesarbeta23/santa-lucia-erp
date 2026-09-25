import { useState } from 'react'
import { C, Btn, Sel, Badge, Empty, SectionHeader, card, fmt, Progress, Modal, Stat } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

const TIPOS_INST = ['instalacion', 'todo_costo']

export default function Instalacion({ dbData, setDbData, toast, nav, irA, puedeEditar, verValorContrato = true, user }) {
  const {
    proyectos = [], contratos = [], items_contrato = [], constructoras = [],
    actas_facturacion = [], items_acta_facturacion = [],
    obras = [], elementos = [], subitems_instalacion = [], entregas_instalacion = [], cantidades_torre = [],
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
  const [torreSel, setTorreSel]   = useState('')        // '' = todas las torres
  const [modalReparto, setModalReparto] = useState(false)
  const [repartoTmp, setRepartoTmp]     = useState({})   // { `${itemId}|${obraId}`: cantidad }
  const [buscaProy, setBuscaProy]       = useState('')   // filtro de la lista de obras

  // ── Helpers ───────────────────────────────────────────────
  const contratosInst = contratos.filter(c => TIPOS_INST.includes(c.tipo))
  const itemsDe   = cid => items_contrato.filter(i => i.contrato_id === cid).sort((a, b) => (a.orden || 0) - (b.orden || 0))
  // Un proyecto puede tener varias torres (cada una es una obra en Gestión de Obras)
  const torresDe  = proy => [...new Set([...(proy?.obras_ids || []), proy?.obra_id].filter(Boolean))]
    .map(id => obras.find(o => o.id === id)).filter(Boolean)
  // Junta las torres en una sola "obra" para sumar; cada piso recuerda de qué torre es
  const unirTorres = torres => torres.length ? {
    id: torres[0].id, nombre: torres.map(t => t.nombre).join(' + '),
    pisos: torres.flatMap(t => (t.pisos || []).map(p => ({ ...p, _torreId: t.id, _torreNombre: t.nombre }))),
  } : null
  const obraDe    = (proy, torreId = '') => {
    const ts = torresDe(proy)
    return unirTorres(torreId ? ts.filter(t => t.id === torreId) : ts)
  }
  const partesDe  = itemId => subitems_instalacion.filter(p => p.item_contrato_id === itemId).sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const elsDeItem = itemId => [...new Set(partesDe(itemId).filter(p => p.elemento_id).map(p => p.elemento_id))]
  const nombreEl  = eid => elementos.find(e => e.id === eid)?.nombre || eid

  // Un elemento solo puede pertenecer a un ítem del contrato.
  // Devuelve el ítem que ya lo tiene (si es otro distinto al que se está editando).

  // Todos los apartamentos de la obra vinculada
  const aptosDe = obra => (obra?.pisos || []).flatMap(p =>
    (p.aptos || []).map(a => ({ ...a, pisoNombre: p.numero ?? p.nombre, torreId: p._torreId, torreNombre: p._torreNombre }))
  )

  // Cuánto del contrato le toca a una torre (si se repartió)
  const asignadoTorre = (itemId, obraId) => {
    const r = cantidades_torre.find(c => c.item_contrato_id === itemId && c.obra_id === obraId)
    return r ? Number(r.cantidad || 0) : null
  }

  // Cantidad instalada de un ítem en un apto: se cuenta solo cuando TODAS
  // sus partes están chuleadas (la constructora paga la unidad terminada).
  // Cuenta los elementos del apto y los de sus tipologías extra
  const elsDelApto = apto => [...(apto.elementos || []), ...(apto.elementosExtra || [])]

  // Elementos que este ítem comparte con otros ítems del mismo contrato (la chapa, por
  // ejemplo, es la misma para todas las puertas). No sirven para decidir si un ítem
  // aplica en un apto: si lo hicieran, un apto con chapa pero sin la puerta de reforma
  // daría esa puerta por instalada.
  const elsPropiosDeItem = itemId => {
    const mios = elsDeItem(itemId)
    if (!mios.length) return mios
    const cid = items_contrato.find(i => i.id === itemId)?.contrato_id
    const otros = new Set(items_contrato
      .filter(i => i.contrato_id === cid && i.id !== itemId)
      .flatMap(i => elsDeItem(i.id)))
    const propios = mios.filter(eid => !otros.has(eid))
    return propios.length ? propios : mios   // si todo es compartido, no hay con qué distinguir
  }

  // Partes del ítem que de verdad lleva ESTE apto según su tipología en Gestión de Obras.
  // Si el apto no tiene ninguna de las partes propias del ítem, el ítem no aplica para él.
  const partesEnApto = (apto, itemId) => {
    const todos = elsDelApto(apto)
    const hay = eid => todos.some(e => e.elementoId === eid)
    if (!elsPropiosDeItem(itemId).some(hay)) return []
    return elsDeItem(itemId).filter(hay)
  }
  const aplicaEnApto = (apto, itemId) => partesEnApto(apto, itemId).length > 0

  function instaladoEnApto(apto, itemId) {
    const eids = partesEnApto(apto, itemId)
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

  // Cuántas unidades del ítem llevan los aptos según Gestión de Obras
  // (lo que está cargado en las tipologías, instalado o no).
  function programadoEnApto(apto, itemId) {
    const eids = partesEnApto(apto, itemId)
    if (!eids.length) return 0
    const todos = elsDelApto(apto)
    let min = Infinity
    for (const eid of eids) {
      const cant = todos.filter(e => e.elementoId === eid).reduce((x, e) => x + Number(e.cantidad || 1), 0)
      min = Math.min(min, cant)
    }
    return min === Infinity ? 0 : min
  }
  const programadoItem = (obra, itemId) =>
    aptosDe(obra).reduce((s, a) => s + programadoEnApto(a, itemId), 0)

  // ── Avance real (parcial) ─────────────────────────────────
  // Una puerta puesta sin chapa no es cero trabajo: es la puerta hecha y la chapa
  // pendiente. Aquí cada parte pesa lo que se le paga al instalador por ella, así que
  // una unidad con ala+marco puestos y chapa pendiente cuenta como fracción, no como 0.
  // Si ninguna parte tiene valor cargado, se reparte parejo entre las partes.
  const pesoParte = p => (Number(p.valor_instalador) || 0) + (Number(p.valor_detallado) || 0)
  const pesosDeItem = itemId => {
    const ps = partesDe(itemId).filter(p => p.elemento_id)
    const total = ps.reduce((s, p) => s + pesoParte(p), 0)
    const m = {}
    ps.forEach(p => { m[p.elemento_id] = total > 0 ? pesoParte(p) / total : 1 / (ps.length || 1) })
    return m
  }

  // Unidades equivalentes instaladas en un apto, contando lo que va de cada parte.
  function avanceEnApto(apto, itemId) {
    const eids = partesEnApto(apto, itemId)
    if (!eids.length) return 0
    const todos = elsDelApto(apto)
    const pesos = pesosDeItem(itemId)
    return eids.reduce((s, eid) => {
      const hechas = todos.filter(e => e.elementoId === eid && e.completado)
        .reduce((x, e) => x + Number(e.cantidad || 1), 0)
      return s + hechas * (pesos[eid] || 0)
    }, 0)
  }
  const avanceItem = (obra, itemId) =>
    aptosDe(obra).reduce((s, a) => s + avanceEnApto(a, itemId), 0)
  // El avance real trae decimales, así que se comparan con tolerancia y se muestran cortos
  const dec = n => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 })
  const cuadra = n => Math.abs(n) < 0.01

  const instaladoItem = (obra, itemId) =>
    aptosDe(obra).reduce((s, a) => s + instaladoEnApto(a, itemId), 0)

  // Cuánto va instalado de un ítem en un apto, EN UNIDADES (para la vista por apto).
  // Antes se contaban partes con `some(completado)`: bastaba una fila marcada para dar
  // la parte por hecha, así que 2 puertas de 4 se veían como completo. Ahora se compara
  // lo instalado contra lo programado, y cada parte solo cuenta si están todas sus unidades.
  function parcialEnApto(apto, itemId) {
    const eids = partesEnApto(apto, itemId)
    if (!eids.length) return { hechas: 0, total: 0, partesHechas: 0, partesTotal: 0 }
    const todos = elsDelApto(apto)
    const unidades = (eid, soloHechas) => todos
      .filter(e => e.elementoId === eid && (!soloHechas || e.completado))
      .reduce((s, e) => s + Number(e.cantidad || 1), 0)
    const partesHechas = eids.filter(eid => {
      const prog = unidades(eid, false)
      return prog > 0 && unidades(eid, true) >= prog
    }).length
    return {
      hechas: instaladoEnApto(apto, itemId),
      total: programadoEnApto(apto, itemId),
      partesHechas, partesTotal: eids.length,
    }
  }

  // ── Entregas a obra (a satisfacción, con memorando) ───────
  const entregaDe = (itemId, aptoId) =>
    entregas_instalacion.find(e => e.item_contrato_id === itemId && e.apto_id === aptoId)

  async function guardarEntrega(it, apto, cambios) {
    const prev = entregaDe(it.id, apto.id)
    const fila = {
      contrato_id: contratoSel.id, item_contrato_id: it.id,
      obra_id: apto.torreId || proySel?.obra_id || null, apto_id: apto.id, apto_nombre: String(apto.nombre || apto.numero || ''),
      entregado: prev?.entregado || false, memorando: prev?.memorando || null,
      fecha_entrega: prev?.fecha_entrega || null,
      ...cambios,
      registrado_por: user?.nombre || null, updated_at: new Date().toISOString(),
    }
    if (cambios.entregado === true && !fila.fecha_entrega) fila.fecha_entrega = new Date().toISOString().slice(0, 10)
    if (cambios.entregado === false) fila.fecha_entrega = null
    try {
      const { data, error } = await supabase.from('entregas_instalacion')
        .upsert(fila, { onConflict: 'item_contrato_id,apto_id' }).select().single()
      if (error) throw error
      setDbData(d => ({
        ...d,
        entregas_instalacion: [
          ...(d.entregas_instalacion || []).filter(e => !(e.item_contrato_id === it.id && e.apto_id === apto.id)),
          data,
        ],
      }))
    } catch (e) { toast('Error: ' + e.message, 'err') }
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

  // ── Crear la obra en Gestión de Obras desde el ERP ────────
  async function crearObra() {
    setSaving(true)
    try {
      const nueva = {
        id: `o${Date.now()}`, nombre: (proySel?.nombre || '').trim(), direccion: '',
        estado: 'activa', pisos: [], tipologias: [],
        instaladores_autorizados: [], aptos_habilitados: {}, solicitudes: [], precios_override: {},
        coordinador_id: '',
      }
      const { data: obraCreada, error } = await supabase.from('obras').insert(nueva).select().single()
      if (error) throw error
      const { data: proy, error: e2 } = await supabase.from('proyectos')
        .update({ obra_id: obraCreada.id }).eq('id', proySel.id).select().single()
      if (e2) throw e2
      setDbData(d => ({
        ...d,
        obras: [...(d.obras || []), obraCreada],
        proyectos: d.proyectos.map(p => p.id === proy.id ? proy : p),
      }))
      setProySel(proy)
      toast('Obra creada y vinculada', 'ok')
      setModalObra(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
  }

  // ── Partes del ítem (lo que se paga a la gente) ───────────


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
    .filter(el => el.activo !== false && (!el.obra_id || torresDe(proySel).some(t => t.id === el.obra_id)))
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))

  // Copia el desglose de otro ítem, cambiando el prefijo del nombre.
  // Ej: "P-01 ala y marco" al copiarlo a P-02 queda "P-02 ala y marco".
  function copiarDesglose(itemOrigenId) {
    const origen = its.find(i => i.id === itemOrigenId)
    const ps = partesDe(itemOrigenId)
    if (!ps.length) return
    const refO = (origen?.ref || '').trim()
    const refD = (partesItem?.ref || '').trim()
    setPartesTmp(ps.map(p => ({
      nombre: refO && p.nombre.includes(refO) ? p.nombre.split(refO).join(refD) : `${refD} ${p.nombre}`.trim(),
      unidad: p.unidad || 'und',
      valor_instalador: p.valor_instalador || 0,
      valor_detallado: p.valor_detallado || 0,
      elemento_id: null,          // se crean nuevos elementos para este ítem
    })))
    toast(`Copiado el desglose de ${refO}`, 'ok')
  }

  async function guardarPartes() {
    setSaving(true)
    try {
      // Una fila cuenta si tiene nombre O si ya se le escogió el elemento de la obra.
      // Antes se botaban sin avisar las filas con elemento y sin nombre escrito.
      const filas = partesTmp.filter(p => p.nombre?.trim() || p.elemento_id)
      await supabase.from('subitems_instalacion').delete().eq('item_contrato_id', partesItem.id)
      let nuevas = []
      if (filas.length) {
        const rows = filas.map((p, i) => ({
          item_contrato_id: partesItem.id,
          nombre: p.nombre?.trim() || nombreEl(p.elemento_id),   // sin nombre, se usa el del elemento
          unidad: p.unidad || 'und',
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
          obra_id: torresDe(proySel)[0]?.id || proySel.obra_id, item_contrato_id: it.id,
          obras_extra: torresDe(proySel).slice(1).map(t => t.id),
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

  // ── Vista lista de proyectos ──────────────────────────────
  if (vista === 'lista') {
    const todosProys = proyectos.filter(p => contratosInst.some(c => c.proyecto_id === p.id))
    // Busca por nombre de obra, de constructora o de torre
    const q = buscaProy.trim().toLowerCase()
    const proys = !q ? todosProys : todosProys.filter(p => {
      const constr = constructoras.find(x => x.id === p.constructora_id)?.nombre || ''
      const torres = torresDe(p).map(t => t.nombre).join(' ')
      return `${p.nombre} ${constr} ${torres}`.toLowerCase().includes(q)
    })
    return (
      <div>
        <SectionHeader title="🔧 Instalación" />
        {todosProys.length > 0 && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <input value={buscaProy} onChange={e => setBuscaProy(e.target.value)}
              placeholder="Buscar obra, constructora o torre…"
              style={{ flex: 1, minWidth: 240, maxWidth: 420, padding: '9px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, outline: 'none' }} />
            <select value="" onChange={e => {
                const p = todosProys.find(x => x.id === e.target.value)
                if (p) { setProySel(p); setVista('proyecto') }
              }}
              style={{ padding: '9px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, minWidth: 200, background: 'white' }}>
              <option value="">Ir directo a una obra…</option>
              {todosProys.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <span style={{ fontSize: 12, color: C.g5 }}>{proys.length} de {todosProys.length}</span>
          </div>
        )}
        {todosProys.length === 0 ? (
          <Empty icon="🔧" title="Sin contratos de instalación"
            desc="Los proyectos aparecen aquí cuando tienen un contrato de instalación o todo costo." />
        ) : proys.length === 0 ? (
          <Empty icon="🔍" title="Ninguna obra coincide" desc={`No hay obras que coincidan con "${buscaProy}".`}
            action={<Btn onClick={() => setBuscaProy('')}>Limpiar búsqueda</Btn>} />
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
            <div style={{ fontSize: 11, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {torresDe(proySel).length > 1 ? 'Torres en Gestión de Obras' : 'Obra en Gestión de Obras'}
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {torresDe(proySel).length ? torresDe(proySel).map(t => <span key={t.id}>🏗️ {t.nombre}</span>) : 'Sin vincular'}
            </div>
            {!obra && <div style={{ fontSize: 12, color: C.g5 }}>Sin vincular no se puede leer el avance de los coordinadores.</div>}
          </div>
          {irA && <Btn onClick={() => irA('proyectos', { proyectoId: proySel.id, desde: 'proyecto' })}>
            Torres / obras en el proyecto →
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

        {modalObra && (
          <Modal title="Vincular obra de Gestión de Obras" onClose={() => setModalObra(false)}>
            <Sel label="Obra" value={obraForm} onChange={e => setObraForm(e.target.value)}>
              <option value="">— Sin vincular —</option>
              {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </Sel>
            <p style={{ fontSize: 12, color: C.g5, marginTop: 10 }}>
              Al vincular, el avance que los coordinadores chulean en Gestión de Obras se lee automáticamente acá.
            </p>
            <div style={{ borderTop: `1px solid ${C.g2}`, margin: '16px 0 12px', paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>¿La obra todavía no existe allá?</div>
              <div style={{ fontSize: 12, color: C.g5, marginBottom: 8 }}>
                Se crea con el nombre del proyecto y queda vinculada. Los pisos, apartamentos y tipologías se arman en Gestión de Obras.
              </div>
              <Btn onClick={crearObra} disabled={saving}>
                + Crear "{proySel?.nombre}" en Gestión de Obras
              </Btn>
            </div>
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
  const its    = itemsDe(contratoSel.id)
  const torres = torresDe(proySel)
  const obra   = obraDe(proySel, torreSel)
  const aptos  = aptosDe(obra)

  // Contratado según la torre: si se repartió, lo de esa torre; si no, el contrato completo
  const repartoCubre = it => {
    const suma = torres.reduce((x, t) => x + (asignadoTorre(it.id, t.id) || 0), 0)
    return suma > 0 && suma >= Number(it.cantidad || 0)
  }
  const contratadoDe = it => {
    if (!torreSel) return Number(it.cantidad || 0)
    const v = asignadoTorre(it.id, torreSel)
    return v !== null ? v : (repartoCubre(it) ? 0 : null)
  }
  // Facturado según la torre (actas marcadas con esa torre)
  const facturadoTorre = itemId => {
    if (!torreSel) return facturadoItem(itemId)
    const ids = actas_facturacion.filter(a => a.obra_id === torreSel).map(a => a.id)
    return items_acta_facturacion.filter(i => i.item_contrato_id === itemId && ids.includes(i.acta_facturacion_id))
      .reduce((s, i) => s + Number(i.cantidad || 0), 0)
  }

  // ── Reparto del contrato entre torres ──
  function abrirReparto() {
    const tmp = {}
    for (const it of its) for (const t of torres) {
      const v = asignadoTorre(it.id, t.id)
      tmp[`${it.id}|${t.id}`] = v === null ? '' : String(v)
    }
    setRepartoTmp(tmp); setModalReparto(true)
  }
  function llenarConGestion() {
    const tmp = { ...repartoTmp }
    for (const it of its) for (const t of torres) {
      tmp[`${it.id}|${t.id}`] = String(programadoItem(unirTorres([t]), it.id))
    }
    setRepartoTmp(tmp)
  }
  async function guardarReparto() {
    setSaving(true)
    try {
      const filas = []
      for (const it of its) for (const t of torres) {
        const v = repartoTmp[`${it.id}|${t.id}`]
        if (v === '' || v === undefined) continue
        filas.push({ item_contrato_id: it.id, obra_id: t.id, cantidad: Number(v) || 0 })
      }
      const itemIds = its.map(i => i.id)
      await supabase.from('cantidades_torre').delete().in('item_contrato_id', itemIds)
      let nuevas = []
      if (filas.length) {
        const { data, error } = await supabase.from('cantidades_torre').insert(filas).select()
        if (error) throw error
        nuevas = data
      }
      setDbData(d => ({ ...d, cantidades_torre: [...(d.cantidades_torre || []).filter(c => !itemIds.includes(c.item_contrato_id)), ...nuevas] }))
      toast('Reparto por torre guardado', 'ok')
      setModalReparto(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
  }

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

      {torres.length > 1 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.g5 }}>TORRE:</span>
          {[{ id: '', nombre: 'Todas' }, ...torres].map(t => (
            <button key={t.id || 'todas'} onClick={() => setTorreSel(t.id)} style={{
              padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
              border: `1px solid ${torreSel === t.id ? C.or : C.g2}`,
              background: torreSel === t.id ? C.or : 'white', color: torreSel === t.id ? 'white' : C.g5, fontWeight: 600,
            }}>{t.nombre}</button>
          ))}
          {editable && <Btn size="sm" onClick={abrirReparto}>⚖️ Repartir contrato por torre</Btn>}
        </div>
      )}

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
        <div style={{ ...card, padding: 0, display: 'block', width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#2B313A' }}>
                {['REF', 'DESCRIPCIÓN', 'UM', 'CONTRATADO', 'EN OBRA', 'COMPLETAS', 'AVANCE REAL', 'FACTURADO', 'FALTA INSTALAR', 'POR FACTURAR'].map((h, i) => (
                  <th key={h} style={{ padding: '9px 10px', textAlign: i < 3 ? 'left' : 'right', color: i < 3 ? '#F3D3B5' : '#FCC89B', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {its.map(it => {
                const contrT = contratadoDe(it)            // null = esta torre no tiene reparto
                const contr = contrT ?? 0
                const inst  = obra ? instaladoItem(obra, it.id) : 0
                const avan  = obra ? avanceItem(obra, it.id) : 0   // unidades equivalentes, partes a medias incluidas
                const fact  = facturadoTorre(it.id)
                // Se miden contra el avance real: la obra abona por lo puesto aunque falte
                // el remate, así que contar solo lo completo exageraba el faltante.
                const faltaInst = contr - avan
                const porFact   = avan - fact
                const sinMapa   = elsDeItem(it.id).length === 0
                const prog      = obra ? programadoItem(obra, it.id) : 0
                const difProg   = prog - contr
                return (
                  <tr key={it.id} style={{ borderTop: `1px solid ${C.g1}` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#1D4ED8', whiteSpace: 'nowrap' }}>{it.ref}</td>
                    <td style={{ padding: '8px 10px' }}>
                      {it.descripcion}
                      {sinMapa && <span style={{ fontSize: 11, color: C.or, marginLeft: 8 }}>⚠️ sin desglosar</span>}
                    </td>
                    <td style={{ padding: '8px 10px', color: C.g5 }}>{it.unidad}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                      {contrT === null ? <span style={{ fontSize: 11, color: C.or }}>sin repartir aún</span> : contr.toLocaleString('es-CO')}
                      {torreSel && contrT !== null && <div style={{ fontSize: 10, color: C.g4, fontWeight: 400 }}>de {Number(it.cantidad || 0).toLocaleString('es-CO')}</div>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600,
                      color: sinMapa || !obra || contrT === null ? C.g3 : difProg === 0 ? C.gnD : C.rd }}
                      title={sinMapa ? 'Falta desglosar el ítem' : difProg === 0 ? 'Cuadra con el contrato'
                        : difProg > 0 ? `Los aptos de Gestión llevan ${difProg} más que el contrato` : `A los aptos de Gestión les faltan ${Math.abs(difProg)} frente al contrato`}>
                      {sinMapa || !obra ? '—' : prog.toLocaleString('es-CO')}
                      {!sinMapa && obra && contrT !== null && difProg !== 0 && <div style={{ fontSize: 10, fontWeight: 700 }}>{difProg > 0 ? `+${difProg}` : difProg} vs {torreSel ? 'lo de la torre' : 'contrato'}</div>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: inst > 0 ? C.gnD : C.g3 }}>{inst.toLocaleString('es-CO')}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: avan > inst ? C.or : avan > 0 ? C.gnD : C.g3 }}
                      title={avan > inst ? `Hay ${(avan - inst).toFixed(2)} unidades con partes puestas que todavía no están completas` : 'Todo lo empezado está completo'}>
                      {avan > 0 ? avan.toLocaleString('es-CO', { maximumFractionDigits: 2 }) : '—'}
                      {avan > inst && <div style={{ fontSize: 10, fontWeight: 700 }}>+{(avan - inst).toLocaleString('es-CO', { maximumFractionDigits: 2 })} a medias</div>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: fact > 0 ? C.bk : C.g3 }}>{fact.toLocaleString('es-CO')}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700,
                      color: cuadra(faltaInst) ? C.gnD : faltaInst < 0 ? C.rd : C.or,
                      background: cuadra(faltaInst) ? '#DCFCE7' : faltaInst < 0 ? '#FEE2E2' : '#FFF7ED' }}>
                      {cuadra(faltaInst) ? '✓ Completo' : faltaInst < 0 ? `Exceso ${dec(Math.abs(faltaInst))}` : dec(faltaInst)}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: porFact > 0.01 ? C.or : porFact < -0.01 ? C.rd : C.g4 }}
                      title={porFact < -0.01 ? 'Ya se facturó más de lo que va instalado (la obra abonó por adelantado)' : ''}>
                      {porFact > 0.01 ? dec(porFact) : porFact < -0.01 ? `Adelantado ${dec(Math.abs(porFact))}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#2B313A', fontSize: 12, fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: '9px 10px', color: 'white' }}>TOTALES</td>
                {(() => {
                  const c = its.reduce((s, i) => s + (contratadoDe(i) ?? 0), 0)
                  const i2 = obra ? its.reduce((s, i) => s + instaladoItem(obra, i.id), 0) : 0
                  const f = its.reduce((s, i) => s + facturadoTorre(i.id), 0)
                  const cel = (v, col) => <td style={{ padding: '9px 10px', textAlign: 'right', color: col }}>{v.toLocaleString('es-CO')}</td>
                  const p = obra ? its.reduce((s, i) => s + programadoItem(obra, i.id), 0) : 0
                  const av = obra ? its.reduce((s, i) => s + avanceItem(obra, i.id), 0) : 0
                  return <>
                    {cel(c, 'white')}
                    {cel(p, '#FDE68A')}
                    {cel(i2, '#86EFAC')}
                    <td style={{ padding: '9px 10px', textAlign: 'right', color: '#FDBA74' }}>
                      {av.toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                    </td>
                    {cel(f, '#F3D3B5')}
                    <td style={{ padding: '9px 10px', textAlign: 'right', color: '#FDBA74' }}>
                      {(c - av).toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', color: '#FDBA74' }}>
                      {Math.max(0, av - f).toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                    </td>
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
          : <>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: C.g5, marginBottom: 8, flexWrap: 'wrap' }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 3, marginRight: 5, verticalAlign: 'middle' }} />Falta remate (ej. sin chapa)</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#DCFCE7', border: '1px solid #BBF7D0', borderRadius: 3, marginRight: 5, verticalAlign: 'middle' }} />Instalado completo</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#FED7AA', border: '1px solid #FDBA74', borderRadius: 3, marginRight: 5, verticalAlign: 'middle' }} />Entregado a obra</span>
            </div>
            <div style={{ ...card, padding: 0, display: 'block', width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#2B313A' }}>
                    <th style={{ padding: '9px 10px', textAlign: 'left', color: '#F3D3B5', fontSize: 10, fontWeight: 700 }}>APTO</th>
                    {its.map(it => [
                      <th key={it.id} style={{ padding: '9px 8px', textAlign: 'center', color: '#FCC89B', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', borderLeft: '2px solid #3A414B' }}>{it.ref}</th>,
                      <th key={it.id + 'e'} style={{ padding: '9px 8px', textAlign: 'center', color: '#FDBA74', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>ENTREGA {it.ref}</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {aptos.map(a => (
                    <tr key={a.id} style={{ borderTop: `1px solid ${C.g1}` }}>
                      <td style={{ padding: '7px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {a.nombre || a.numero}
                        <span style={{ fontSize: 10, color: C.g5, marginLeft: 6 }}>P{a.pisoNombre}</span>
                        {torres.length > 1 && !torreSel && <div style={{ fontSize: 9, color: C.or, fontWeight: 600 }}>{a.torreNombre}</div>}
                      </td>
                      {its.map(it => {
                        const { hechas, total, partesHechas, partesTotal } = parcialEnApto(a, it.id)
                        // Completo = todas las unidades y todas las partes (puerta, chapa, tope…)
                        const listo = total > 0 && hechas >= total && partesHechas === partesTotal
                        // Parcial: hay partes puestas pero todavía no está completo (típico:
                        // la puerta instalada y la chapa pendiente). No es cero trabajo.
                        const avApto = avanceEnApto(a, it.id)
                        const parcial = !listo && total > 0 && avApto > 0
                        const ent = entregaDe(it.id, a.id)
                        const entregado = !!ent?.entregado
                        const fondoEnt = '#FED7AA'   // naranja tenue: ya entregado a obra
                        return [
                          <td key={it.id} title={total === 0 ? '' : `${hechas} de ${total} unidades · ${partesHechas} de ${partesTotal} partes`}
                            style={{ padding: '6px 8px', textAlign: 'center', borderLeft: `2px solid ${C.g2}`,
                            background: entregado ? fondoEnt : listo ? '#DCFCE7' : parcial ? '#FEF3C7' : undefined }}>
                            {total === 0 ? <span style={{ color: C.g3 }}>—</span>
                              : listo ? <span style={{ color: entregado ? '#9A3412' : C.gnD, fontWeight: 700 }}>✓</span>
                              : parcial ? <span style={{ color: '#B45309', fontWeight: 700 }}>
                                  ✓<span style={{ fontSize: 9, fontWeight: 600, display: 'block', lineHeight: 1 }}>falta remate</span>
                                </span>
                              : <span style={{ color: C.g4, fontSize: 11 }}>{hechas}/{total}</span>}
                          </td>,
                          <td key={it.id + 'e'} style={{ padding: '4px 6px', background: entregado ? fondoEnt : undefined, whiteSpace: 'nowrap' }}
                            title={entregado ? `Entregado a obra${ent.fecha_entrega ? ' el ' + ent.fecha_entrega : ''}${ent.memorando ? ' · memo ' + ent.memorando : ''}` : (listo ? 'Marcar como entregado a obra' : parcial ? 'Empezado pero sin rematar: falta alguna parte' : 'Primero debe estar instalado completo')}>
                            {total === 0 ? <span style={{ color: C.g3 }}>—</span> : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input type="checkbox" checked={entregado}
                                  disabled={!editable || (!listo && !entregado)}
                                  onChange={e => guardarEntrega(it, a, { entregado: e.target.checked })}
                                  style={{ cursor: editable && (listo || entregado) ? 'pointer' : 'not-allowed' }} />
                                <input key={ent?.memorando || ''} defaultValue={ent?.memorando || ''} placeholder="Memo"
                                  disabled={!editable}
                                  onBlur={e => { const v = e.target.value.trim(); if (v !== (ent?.memorando || '')) guardarEntrega(it, a, { memorando: v || null }) }}
                                  style={{ width: 74, padding: '3px 6px', border: `1px solid ${entregado ? '#FDBA74' : C.g2}`, borderRadius: 5, fontSize: 11, background: entregado ? '#FFF7ED' : 'white' }} />
                              </div>
                            )}
                          </td>,
                        ]
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#2B313A', fontWeight: 700 }}>
                    <td style={{ padding: '8px 10px', color: 'white', fontSize: 11 }}>INSTALADO</td>
                    {its.map(it => {
                      const tot = aptos.reduce((s, a) => s + instaladoEnApto(a, it.id), 0)
                      const ent = aptos.filter(a => entregaDe(it.id, a.id)?.entregado).length
                      return [
                        <td key={it.id} style={{ padding: '8px 8px', textAlign: 'center', color: tot > 0 ? '#86EFAC' : '#94A3B8' }}>{tot.toLocaleString('es-CO')}</td>,
                        <td key={it.id + 'e'} style={{ padding: '8px 8px', textAlign: 'center', color: '#FDBA74', fontSize: 11 }}>{ent} apto(s) entregados</td>,
                      ]
                    })}
                  </tr>
                  <tr style={{ background: '#23272E', fontWeight: 600 }}>
                    <td style={{ padding: '6px 10px', color: '#CBD5E1', fontSize: 11 }}>CONTRATADO</td>
                    {its.map(it => [
                      <td key={it.id} style={{ padding: '6px 8px', textAlign: 'center', color: '#CBD5E1' }}>{contratadoDe(it) === null ? '—' : contratadoDe(it).toLocaleString('es-CO')}</td>,
                      <td key={it.id + 'e'} />,
                    ])}
                  </tr>
                  <tr style={{ background: '#23272E', fontWeight: 600 }}>
                    <td style={{ padding: '6px 10px', color: '#CBD5E1', fontSize: 11 }}>FALTA</td>
                    {its.map(it => {
                      const falta = (contratadoDe(it) ?? 0) - aptos.reduce((s, a) => s + instaladoEnApto(a, it.id), 0)
                      return [
                        <td key={it.id} style={{ padding: '6px 8px', textAlign: 'center', color: falta > 0 ? '#FDBA74' : '#86EFAC' }}>{falta > 0 ? falta.toLocaleString('es-CO') : '✓'}</td>,
                        <td key={it.id + 'e'} />,
                      ]
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
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

      {/* Modal reparto por torre */}
      {modalReparto && (
        <Modal title="Repartir el contrato por torre" onClose={() => setModalReparto(false)} wide>
          <p style={{ fontSize: 13, color: C.g5, marginBottom: 10 }}>
            Cuánto de cada ítem del contrato se ejecuta en cada torre. Con eso el avance, la validación y el
            "por facturar" de cada torre se comparan contra lo suyo, no contra el contrato completo.
          </p>
          <div style={{ marginBottom: 10 }}>
            <Btn size="sm" onClick={llenarConGestion}>↧ Llenar con lo cargado en Gestión de Obras</Btn>
          </div>
          <div style={{ ...card, padding: 0, display: 'block', width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.g1 }}>
                  <th style={{ padding: '7px 10px', textAlign: 'left' }}>ÍTEM</th>
                  <th style={{ padding: '7px 10px', textAlign: 'right' }}>CONTRATO</th>
                  {torres.map(t => <th key={t.id} style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{t.nombre}</th>)}
                  <th style={{ padding: '7px 10px', textAlign: 'right' }}>SIN REPARTIR</th>
                </tr>
              </thead>
              <tbody>
                {its.map(it => {
                  const total = Number(it.cantidad || 0)
                  const suma = torres.reduce((x, t) => x + (Number(repartoTmp[`${it.id}|${t.id}`]) || 0), 0)
                  const resto = total - suma
                  return (
                    <tr key={it.id} style={{ borderTop: `1px solid ${C.g1}` }}>
                      <td style={{ padding: '6px 10px' }}><strong style={{ color: '#1D4ED8' }}>{it.ref}</strong> <span style={{ color: C.g5 }}>{String(it.descripcion || '').slice(0, 40)}</span></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{total.toLocaleString('es-CO')}</td>
                      {torres.map(t => (
                        <td key={t.id} style={{ padding: '4px 8px', textAlign: 'right' }}>
                          <input type="number" min="0" value={repartoTmp[`${it.id}|${t.id}`] ?? ''}
                            onChange={e => setRepartoTmp(r => ({ ...r, [`${it.id}|${t.id}`]: e.target.value }))}
                            style={{ width: 80, padding: '4px 6px', border: `1px solid ${C.g2}`, borderRadius: 6, textAlign: 'right', fontSize: 12 }} />
                        </td>
                      ))}
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: resto === 0 ? C.gnD : resto < 0 ? C.rd : C.or }}>
                        {resto === 0 ? '✓' : resto.toLocaleString('es-CO')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setModalReparto(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardarReparto} disabled={saving}>{saving ? 'Guardando…' : 'Guardar reparto'}</Btn>
          </div>
        </Modal>
      )}

      {/* Modal partes */}
      {partesItem && (
        <Modal title={`Partes de: ${partesItem.descripcion}`} onClose={() => setPartesItem(null)} wide>
          {(() => {
            const conPartes = its.filter(i => i.id !== partesItem.id && partesDe(i.id).length > 0)
            if (!conPartes.length) return null
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '10px 12px', background: '#EFF6FF', border: '1px solid #F3D3B5', borderRadius: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#2B313A' }}>⧉ Igual que:</span>
                <select defaultValue="" onChange={e => { if (e.target.value) { copiarDesglose(e.target.value); e.target.value = '' } }}
                  style={{ padding: '6px 10px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 13, flex: 1, minWidth: 200 }}>
                  <option value="">— Copiar el desglose de otro ítem —</option>
                  {conPartes.map(i => (
                    <option key={i.id} value={i.id}>{i.ref} · {partesDe(i.id).length} partes</option>
                  ))}
                </select>
              </div>
            )
          })()}

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
                  onChange={e => setPartesTmp(t => t.map((x, j) => j !== i ? x : {
                    ...x, elemento_id: e.target.value || null,
                    // si la parte no tiene nombre, se le pone el del elemento escogido
                    nombre: x.nombre?.trim() ? x.nombre : (e.target.value ? nombreEl(e.target.value) : x.nombre),
                  }))}
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
