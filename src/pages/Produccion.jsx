import { useState } from 'react'
import { C, Btn, Inp, Sel, Txt, Modal, Badge, Empty, SectionHeader, card, fmt, fmtDate, Progress } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

const ESTADOS_LOTE = {
  pendiente:   { label: 'Pendiente',   color: 'gray'   },
  en_proceso:  { label: 'En proceso',  color: 'amber'  },
  completado:  { label: 'Completado',  color: 'green'  },
}

export default function Produccion({ dbData, setDbData, toast, nav, irA, puedeEditar, verValorContrato = true }) {
  const editable = puedeEditar ? puedeEditar('produccion') : true
  const {
    proyectos = [], constructoras = [], contratos = [],
    items_contrato = [], lotes_produccion = [], items_lote = [],
    remisiones = [], items_remision = [],
    obras = [], cantidades_torre = [],
  } = dbData

  // Si viene desde el dashboard del proyecto, abrir directo
  const navContr = nav?.contratoId ? contratos.find(c => c.id === nav.contratoId) : null
  const navProy  = proyectos.find(p => p.id === (navContr?.proyecto_id || nav?.proyectoId)) || null
  const [vista, setVista]           = useState(navContr ? 'contrato' : navProy ? 'proyecto' : 'lista')   // lista | proyecto | contrato
  const [proySel, setProySel]       = useState(navProy)
  const [contratoSel, setContratoSel] = useState(navContr)
  const [modalCierre, setModalCierre] = useState(null)   // { lote, soloAjuste }
  const [modalLotes, setModalLotes] = useState(false)
  const [nLotes, setNLotes]         = useState(4)
  const [editando, setEditando]     = useState({})        // { loteId_itemId: valor }
  const [saving, setSaving]         = useState(false)
  const [filtProy, setFiltProy]     = useState('')
  const [torreSel, setTorreSel]     = useState('')

  // ── Torres: cada lote es de una torre (obra en Gestión de Obras) ──
  const torresDe = proy => [...new Set([...(proy?.obras_ids || []), proy?.obra_id].filter(Boolean))]
    .map(id => obras.find(o => o.id === id)).filter(Boolean)
  const torres  = torresDe(proySel)
  const multi   = torres.length > 1
  const tP      = multi ? (torreSel || torres[0].id) : ''       // torre activa ('' si solo hay una)
  // Lo que no tiene torre (lotes y remisiones de antes) se considera de la primera torre
  const torreDe = x => x?.obra_id || torres[0]?.id || ''
  const asignadoTorre = (itemId, obraId) => {
    const r = cantidades_torre.find(c => c.item_contrato_id === itemId && c.obra_id === obraId)
    return r ? Number(r.cantidad || 0) : null
  }
  // Contratado para la torre activa (null = sin repartir)
  const repartoCubre = it => {
    const suma = torres.reduce((x, t) => x + (asignadoTorre(it.id, t.id) || 0), 0)
    return suma > 0 && suma >= Number(it.cantidad || 0)
  }
  const contratadoDe = it => {
    if (!multi) return Number(it.cantidad || 0)
    const v = asignadoTorre(it.id, tP)
    return v !== null ? v : (repartoCubre(it) ? 0 : null)
  }

  // ── Helpers ───────────────────────────────────────────────
  const cantDespLote = (loteId, itemContratoId) =>
    remisiones
      .filter(r => r.lote_id === loteId)
      .flatMap(r => items_remision.filter(i => i.remision_id === r.id && i.item_contrato_id === itemContratoId))
      .reduce((s, i) => s + Number(i.cantidad || 0), 0)

  // Despachado total del ítem (todas las remisiones, con o sin lote)
  const cantDespTotal = (itemContratoId, obraId = tP) => {
    const rems = obraId ? remisiones.filter(r => torreDe(r) === obraId).map(r => r.id) : null
    return items_remision
      .filter(i => i.item_contrato_id === itemContratoId && (!rems || rems.includes(i.remision_id)))
      .reduce((s, i) => s + Number(i.cantidad || 0), 0)
  }

  const lotesContrato = (cid, obraId = tP) =>
    lotes_produccion.filter(l => l.contrato_id === cid && (!obraId || torreDe(l) === obraId)).sort((a, b) => a.numero - b.numero)

  const itemsLote = (loteId) =>
    items_lote.filter(i => i.lote_id === loteId)

  const totalLote = (loteId) =>
    items_lote.filter(i => i.lote_id === loteId).reduce((s, i) => s + Number(i.cantidad || 0), 0)

  // Lo despachado se reparte en cascada entre los lotes, en orden:
  // primero se llena el Lote 1, lo que sobre cuenta para el Lote 2, y así.
  // Así el avance no depende de a qué lote se le cargó la remisión.
  const despEnLote = (lote, itemContratoId) => {
    const tLote = multi ? torreDe(lote) : ''
    const lotes = lotesContrato(lote.contrato_id, tLote)
    const total = cantDespTotal(itemContratoId, tLote)
    let restante = total
    for (const l of lotes) {
      const plan = Number(items_lote.find(i => i.lote_id === l.id && i.item_contrato_id === itemContratoId)?.cantidad || 0)
      const usa = Math.min(plan, Math.max(0, restante))
      if (l.id === lote.id) {
        // al último lote se le carga también lo que se haya despachado de más
        const esUltimo = lotes[lotes.length - 1].id === l.id
        return esUltimo ? Math.max(usa, restante) : usa
      }
      restante -= usa
    }
    return 0
  }

  // Un lote pendiente que ya tiene despachos se considera en proceso
  const estadoLote = (lote) => {
    if (lote.estado !== 'pendiente') return lote.estado
    const its = items_lote.filter(i => i.lote_id === lote.id)
    return its.some(i => despEnLote(lote, i.item_contrato_id) > 0) ? 'en_proceso' : 'pendiente'
  }

  const pctLote = (loteId) => {
    const lote = lotes_produccion.find(l => l.id === loteId)
    const its = items_lote.filter(i => i.lote_id === loteId)
    const plan = its.reduce((s, i) => s + Number(i.cantidad || 0), 0)
    const desp = its.reduce((s, i) => s + (lote ? despEnLote(lote, i.item_contrato_id) : 0), 0)
    return plan > 0 ? (Math.min(desp, plan) / plan) * 100 : 0
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
    if (multi && itsContr.every(it => asignadoTorre(it.id, tP) === null)) {
      toast('Primero reparte el contrato por torre (en Despachos o Instalación)', 'err'); return
    }
    setSaving(true)
    try {
      // Eliminar los lotes anteriores del contrato (solo los de esta torre)
      const lotesAnt = lotesContrato(contratoSel.id)
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
          obra_id: tP || null,
        }).select().single()
        if (error) throw error
        lotesNuevos.push(lote)
      }

      // Distribuir ítems en lotes
      const itemsLoteNuevos = []
      for (const it of itsContr) {
        const cant = contratadoDe(it) ?? 0
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
          ...d.lotes_produccion.filter(l => !lotesAnt.some(x => x.id === l.id)),
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

  // ── Completar lote (con opción de pasar saldo al siguiente) ──
  // Saldo = plan del lote − despachado con ese lote.
  //  · Si faltó (saldo > 0): el lote queda con lo despachado y lo que faltó se suma al siguiente lote abierto.
  //  · Si se mandó de más (saldo < 0): el lote queda con lo despachado y el exceso se descuenta de los siguientes.
  function saldosLote(lote) {
    return itemsLote(lote.id).map(il => {
      const plan = Number(il.cantidad || 0)
      const desp = despEnLote(lote, il.item_contrato_id)
      return { il, plan, desp, saldo: plan - desp, it: items_contrato.find(x => x.id === il.item_contrato_id) }
    }).filter(x => x.saldo !== 0)
  }

  // A dónde va el saldo de un lote, en orden:
  //  1) los lotes abiertos que siguen EN SU MISMA TORRE;
  //  2) si ahí se acaba, los lotes abiertos de las torres siguientes.
  // Lo segundo pasa cuando producción adelanta material de la torre que viene
  // (p. ej. se corrió más zócalo aprovechando el montaje). El contrato es uno solo,
  // así que el material no se pierde: se descuenta del plan de la otra torre.
  // Ojo: se filtra por la torre DEL LOTE, no por la que esté seleccionada en pantalla.
  function siguientesAbiertos(lote) {
    const tLote = multi ? torreDe(lote) : ''
    const abiertos = l => l.estado !== 'completado'
    const propios = lotesContrato(lote.contrato_id, tLote).filter(l => l.numero > lote.numero && abiertos(l))
    if (!multi) return propios
    const iTorre = torres.findIndex(t => t.id === tLote)
    const otras = torres.slice(iTorre + 1).flatMap(t =>
      lotesContrato(lote.contrato_id, t.id).filter(abiertos))
    return [...propios, ...otras]
  }
  // Nombre a mostrar del destino: si es de otra torre, se dice de cuál
  const destinoLabel = (lote, dest) => {
    if (!dest) return ''
    if (!multi || torreDe(dest) === torreDe(lote)) return dest.nombre
    return `${dest.nombre} de ${torres.find(t => t.id === torreDe(dest))?.nombre || 'la otra torre'}`
  }

  function pedirCierre(lote) {
    if (saldosLote(lote).length === 0) { cambiarEstado(lote.id, 'completado'); return }
    setModalCierre({ lote, soloAjuste: false })
  }

  // ── Pasar material despachado de una torre a la siguiente ──
  // Caso real: una misma remisión sale con material de la Torre 1 y de la Torre 2 (se
  // corrió de más aprovechando el montaje). Aquí se parte esa remisión: la cantidad de
  // más se le resta a la remisión de la torre de origen y se crea su gemela en la torre
  // destino, con el mismo número y una nota de dónde viene.
  // Lo que NO cambia: el plan de los lotes de la torre destino, su contratado, ni la
  // suma del contrato. El excedente simplemente pasa a contar como despacho de esa torre.
  async function moverDespachoDeTorre(loteOrigen, loteDestino, movs) {
    const tOrigen  = torreDe(loteOrigen)
    const tDestino = torreDe(loteDestino)
    const nomOrigen = torres.find(t => t.id === tOrigen)?.nombre || 'la otra torre'
    // Remisiones de la torre de origen, de la más reciente hacia atrás
    const remsOrigen = remisiones
      .filter(r => r.contrato_id === loteOrigen.contrato_id && torreDe(r) === tOrigen)
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))

    const porRemision = {}    // remision_id → [{ itemId, cantidad }]
    const bajas = []          // items_remision que quedan con menos cantidad
    for (const mv of movs) {
      let falta = mv.cantidad
      for (const r of remsOrigen) {
        if (falta <= 0) break
        const ir = items_remision.find(i => i.remision_id === r.id && i.item_contrato_id === mv.itemId)
        const disp = Number(ir?.cantidad || 0) - (bajas.find(b => b.id === ir?.id)?.quitado || 0)
        if (!ir || disp <= 0) continue
        const quita = Math.min(falta, disp)
        const ya = bajas.find(b => b.id === ir.id)
        if (ya) ya.quitado += quita
        else bajas.push({ id: ir.id, original: Number(ir.cantidad || 0), quitado: quita })
        ;(porRemision[r.id] ||= []).push({ itemId: mv.itemId, cantidad: quita })
        falta -= quita
      }
    }
    if (!bajas.length) { toast('No se encontró la remisión de donde salió ese excedente', 'err'); return }

    // 1) Bajar la cantidad en la remisión de origen (o borrar la línea si queda en cero)
    const irActualizados = [], irBorrados = []
    for (const b of bajas) {
      const resto = b.original - b.quitado
      if (resto > 0) {
        const { data, error } = await supabase.from('items_remision').update({ cantidad: resto }).eq('id', b.id).select().single()
        if (error) throw error
        irActualizados.push(data)
      } else {
        const { error } = await supabase.from('items_remision').delete().eq('id', b.id)
        if (error) throw error
        irBorrados.push(b.id)
      }
    }
    // 2) Crear la remisión gemela en la torre destino, una por cada remisión de origen
    const remsNuevas = [], irNuevos = []
    for (const [remId, lineas] of Object.entries(porRemision)) {
      const orig = remisiones.find(r => r.id === remId)
      const { data: rem, error } = await supabase.from('remisiones').insert({
        proyecto_id: orig.proyecto_id,
        contrato_id: orig.contrato_id,
        numero: orig.numero,
        fecha: orig.fecha,
        transportador: orig.transportador || null,
        notas: `Parte de la remisión ${orig.numero} que salió para ${nomOrigen}${orig.notas ? ` · ${orig.notas}` : ''}`,
        lote_id: loteDestino.id,
        obra_id: tDestino,
      }).select().single()
      if (error) throw error
      remsNuevas.push(rem)
      for (const l of lineas) {
        const { data, error: e2 } = await supabase.from('items_remision')
          .insert({ remision_id: rem.id, item_contrato_id: l.itemId, cantidad: l.cantidad }).select().single()
        if (e2) throw e2
        irNuevos.push(data)
      }
    }
    setDbData(d => ({
      ...d,
      remisiones: [...d.remisiones, ...remsNuevas],
      items_remision: [
        ...d.items_remision
          .filter(i => !irBorrados.includes(i.id))
          .map(i => irActualizados.find(a => a.id === i.id) || i),
        ...irNuevos,
      ],
    }))
  }

  // soloExcesos: solo ajusta lo que se despachó de más; lo que falta se deja
  // en su lote para seguir despachando.
  async function completarLote(lote, pasarSaldo, cerrar = true, soloExcesos = false) {
    setSaving(true)
    try {
      if (pasarSaldo) {
        const sigs = siguientesAbiertos(lote)
        const cambios = {}      // items_lote.id → nueva cantidad
        const nuevos  = []      // filas items_lote que no existen en lotes siguientes
        const cantDe = (loteId, itemId) => {
          const il = items_lote.find(i => i.lote_id === loteId && i.item_contrato_id === itemId)
          if (!il) return { il: null, cant: 0 }
          return { il, cant: cambios[il.id] ?? Number(il.cantidad || 0) }
        }
        // Dentro de la MISMA torre el saldo se mueve cambiando el plan de los lotes.
        // Hacia OTRA torre no: ahí lo que hubo fue una remisión que llevó material de
        // las dos torres. Ese excedente se reparte como despacho de la torre destino —
        // su plan, su contratado y la suma del contrato quedan iguales (ver moverDespacho).
        const tLote = multi ? torreDe(lote) : ''
        const sigsPropios = sigs.filter(l => !multi || torreDe(l) === tLote)
        const sigsOtras   = sigs.filter(l => multi && torreDe(l) !== tLote)
        const aOtraTorre  = []   // { itemId, cantidad } que se pasan a la torre siguiente

        for (const s of saldosLote(lote).filter(x => !soloExcesos || x.saldo < 0)) {
          const itemId = s.il.item_contrato_id
          if (s.saldo > 0) {
            // Faltó: solo se mueve dentro de la misma torre. Un faltante de esta torre
            // no se tapa quitándole plan a la siguiente.
            if (!sigsPropios.length) continue
            cambios[s.il.id] = s.desp
            const { il, cant } = cantDe(sigsPropios[0].id, itemId)
            if (il) cambios[il.id] = cant + s.saldo
            else nuevos.push({ lote_id: sigsPropios[0].id, item_contrato_id: itemId, cantidad: s.saldo })
            continue
          }
          // Sobró: primero se absorbe en los lotes que siguen en esta torre…
          let exceso = -s.saldo
          let absorbido = 0
          for (const sl of sigsPropios) {
            if (exceso <= 0) break
            const { il, cant } = cantDe(sl.id, itemId)
            if (!il || cant <= 0) continue
            const quita = Math.min(exceso, cant)
            cambios[il.id] = cant - quita
            exceso -= quita; absorbido += quita
          }
          // El lote sube su plan solo por lo que se absorbió aquí; lo que se va a otra
          // torre no le pertenece a este lote y por eso no entra en su plan.
          if (absorbido > 0) cambios[s.il.id] = s.plan + absorbido
          // …y lo que quede se pasa a la torre siguiente como despacho de esa torre.
          if (exceso > 0 && sigsOtras.length) aOtraTorre.push({ itemId, cantidad: exceso })
        }
        const actualizados = []
        for (const [id, cantidad] of Object.entries(cambios)) {
          const { data, error } = await supabase.from('items_lote').update({ cantidad }).eq('id', id).select().single()
          if (error) throw error
          actualizados.push(data)
        }
        const insertados = []
        for (const n of nuevos) {
          const { data, error } = await supabase.from('items_lote').insert(n).select().single()
          if (error) throw error
          insertados.push(data)
        }
        setDbData(d => ({
          ...d,
          items_lote: [
            ...d.items_lote.map(i => actualizados.find(a => a.id === i.id) || i),
            ...insertados,
          ],
        }))
        if (aOtraTorre.length) await moverDespachoDeTorre(lote, sigsOtras[0], aOtraTorre)
      }
      if (cerrar) await cambiarEstado(lote.id, 'completado')
      toast(cerrar
        ? (pasarSaldo ? `${lote.nombre} completado y saldo trasladado` : `${lote.nombre} completado`)
        : 'Saldo trasladado al siguiente lote', 'ok')
      setModalCierre(null)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSaving(false)
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
          {nav?.desde === 'proyecto' && irA && <Btn variant="primary" onClick={() => irA('proyectos', { proyectoId: nav.proyectoId })}>← Volver al proyecto</Btn>}
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{tipo} {contratoSel.numero ? `#${contratoSel.numero}` : ''}</h1>
            <div style={{ fontSize: 13, color: C.g5 }}>{proySel?.nombre}{verValorContrato ? ` · ${fmt(contratoSel.valor_total)}` : ''}</div>
          </div>
          {multi && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.g5 }}>TORRE:</span>
              {torres.map(t => (
                <button key={t.id} onClick={() => setTorreSel(t.id)} style={{
                  padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600,
                  border: `1px solid ${tP === t.id ? C.or : C.g2}`, background: tP === t.id ? C.or : 'white', color: tP === t.id ? 'white' : C.g5,
                }}>{t.nombre}</button>
              ))}
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {editable && <Btn onClick={() => setModalLotes(true)}>
              {lotes.length ? '🔄 Regenerar lotes' : '⚙️ Definir lotes'}
            </Btn>}
          </div>
        </div>

        {lotes.length === 0 ? (
          <Empty icon="🏭" title="Sin lotes definidos"
            desc="Define cuántos lotes de producción tiene este contrato para dividir las cantidades automáticamente."
            action={editable ? <Btn variant="primary" onClick={() => setModalLotes(true)}>⚙️ Definir lotes</Btn> : null} />
        ) : (
          <div>
            {/* Resumen de lotes */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(lotes.length, 5)}, 1fr)`, gap: 10, marginBottom: 20 }}>
              {lotes.map(lote => {
                const pct  = pctLote(lote.id)
                const estL = estadoLote(lote)
                const est  = ESTADOS_LOTE[estL] || ESTADOS_LOTE.pendiente
                const nRem = remisiones.filter(r => r.lote_id === lote.id).length
                return (
                  <div key={lote.id} style={{ ...card, padding: '12px 14px', borderTop: `3px solid ${estL==='completado'?C.gn:estL==='en_proceso'?C.am:C.g3}` }}>
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
                      {editable && estL !== 'en_proceso' && estL !== 'completado' &&
                        <Btn size="sm" onClick={() => cambiarEstado(lote.id, 'en_proceso')}>▶ Iniciar</Btn>}
                      {editable && lote.estado !== 'completado' && saldosLote(lote).some(x => x.saldo < 0) && siguientesAbiertos(lote).length > 0 &&
                        <Btn size="sm" onClick={() => setModalCierre({ lote, soloAjuste: true })}>↪ Pasar excesos</Btn>}
                      {editable && estL === 'en_proceso' &&
                        <Btn size="sm" variant="success" onClick={() => pedirCierre(lote)}>✓ Completar</Btn>}
                      {editable && lote.estado === 'completado' &&
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
            <div style={{ ...card, padding: 0, display: 'block', width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
                <thead>
                  <tr style={{ background: '#2B313A' }}>
                    <th style={{ padding: '9px 12px', textAlign: 'left', color: 'white', fontSize: 10, fontWeight: 700, position: 'sticky', left: 0, background: '#2B313A', zIndex: 1 }}>REF</th>
                    <th style={{ padding: '9px 12px', textAlign: 'left', color: 'white', fontSize: 10, fontWeight: 700 }}>DESCRIPCIÓN</th>
                    <th style={{ padding: '9px 12px', textAlign: 'center', color: 'white', fontSize: 10, fontWeight: 700 }}>UM</th>
                    <th style={{ padding: '9px 12px', textAlign: 'right', color: 'white', fontSize: 10, fontWeight: 700 }}>CONTRATO</th>
                    {lotes.map(l => (
                      <th key={l.id} style={{ padding: '9px 10px', textAlign: 'center', color: 'white', fontSize: 10, fontWeight: 700, minWidth: 90, borderLeft: '1px solid #3A414B' }}>
                        {l.nombre}
                        <div style={{ fontSize: 9, color: '#FCC89B', fontWeight: 400 }}>
                          <Badge color={ESTADOS_LOTE[estadoLote(l)]?.color || 'gray'} >{ESTADOS_LOTE[estadoLote(l)]?.label}</Badge>
                        </div>
                      </th>
                    ))}
                    <th style={{ padding: '9px 10px', textAlign: 'right', color: '#FCC89B', fontSize: 10, fontWeight: 700, borderLeft: '1px solid #3A414B' }}>TOTAL PLAN</th>
                    <th style={{ padding: '9px 10px', textAlign: 'right', color: '#FCC89B', fontSize: 10, fontWeight: 700 }}>DIFERENCIA</th>
                    <th style={{ padding: '9px 10px', textAlign: 'right', color: '#86EFAC', fontSize: 10, fontWeight: 700, borderLeft: '2px solid #3A414B' }}>DESPACHADO</th>
                    <th style={{ padding: '9px 10px', textAlign: 'right', color: '#FDBA74', fontSize: 10, fontWeight: 700 }}>FALTA DESPACHAR</th>
                  </tr>
                </thead>
                <tbody>
                  {itsContr.map((it, idx) => {
                    const contratado = contratadoDe(it) ?? 0
                    const totalPlan  = lotes.reduce((s, l) => {
                      const il = items_lote.find(i => i.lote_id === l.id && i.item_contrato_id === it.id)
                      return s + Number(il?.cantidad || 0)
                    }, 0)
                    const diff      = totalPlan - contratado
                    const despTotal = cantDespTotal(it.id)
                    const falta     = contratado - despTotal
                    return (
                      <tr key={it.id} style={{ borderBottom: `1px solid ${C.g1}`, background: idx % 2 === 0 ? 'white' : C.g0 }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: '#1D4ED8', position: 'sticky', left: 0, background: idx % 2 === 0 ? 'white' : C.g0 }}>{it.ref}</td>
                        <td style={{ padding: '8px 12px', maxWidth: 260 }}>{it.descripcion}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', color: C.g5 }}>{it.unidad}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{contratado.toLocaleString('es-CO')}</td>
                        {lotes.map(l => {
                          const il     = items_lote.find(i => i.lote_id === l.id && i.item_contrato_id === it.id)
                          const cant   = Number(il?.cantidad || 0)
                          const desp   = il ? despEnLote(l, it.id) : 0
                          const key    = il?.id || `${l.id}_${it.id}`
                          const editVal = editando[key]
                          const lleno   = cant > 0 && desp >= cant
                          return (
                            <td key={l.id} style={{ padding: '6px 8px', textAlign: 'center', borderLeft: `1px solid ${C.g1}`, background: lleno ? '#DCFCE7' : undefined }}>
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
                                  <span onClick={() => editable && setEditando(ed => ({ ...ed, [key]: String(cant) }))}
                                    title={editable ? 'Clic para editar' : ''}
                                    style={{ cursor: editable ? 'pointer' : 'default', fontWeight: cant > 0 ? 600 : 400, color: cant > 0 ? C.bk : C.g3, borderBottom: '1px dashed #C7C7CC', paddingBottom: 1 }}>
                                    {cant > 0 ? cant.toLocaleString('es-CO') : '—'}
                                  </span>
                                  {lleno ? (
                                    <div style={{ fontSize: 10, color: C.gnD, marginTop: 2, fontWeight: 700 }}>
                                      ✓ {desp > cant ? `${desp.toLocaleString('es-CO')} desp. (+${(desp - cant).toLocaleString('es-CO')})` : 'completo'}
                                    </div>
                                  ) : desp > 0 && (
                                    <div style={{ fontSize: 10, color: C.am, marginTop: 2 }}>{desp.toLocaleString('es-CO')}/{cant.toLocaleString('es-CO')} desp.</div>
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
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, borderLeft: `2px solid ${C.g2}`, color: despTotal > 0 ? C.gnD : C.g3 }}>
                          {despTotal > 0 ? despTotal.toLocaleString('es-CO') : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700,
                          color: falta === 0 ? C.gnD : falta < 0 ? C.rd : C.or,
                          background: falta === 0 ? '#DCFCE7' : falta < 0 ? '#FEE2E2' : '#FFF7ED' }}>
                          {falta === 0 ? '✓ Completo' : falta < 0 ? `Exceso ${Math.abs(falta).toLocaleString('es-CO')}` : falta.toLocaleString('es-CO')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#2B313A', borderTop: `2px solid ${C.g2}` }}>
                    <td colSpan={3} style={{ padding: '9px 12px', color: 'white', fontWeight: 700, fontSize: 11 }}>TOTAL</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: 'white', fontWeight: 700 }}>
                      {itsContr.reduce((s, it) => s + (contratadoDe(it) ?? 0), 0).toLocaleString('es-CO')}
                    </td>
                    {lotes.map(l => (
                      <td key={l.id} style={{ padding: '9px 10px', textAlign: 'center', color: 'white', fontWeight: 700, borderLeft: '1px solid #3A414B' }}>
                        {items_lote.filter(i => i.lote_id === l.id).reduce((s,i) => s+Number(i.cantidad||0), 0).toLocaleString('es-CO')}
                      </td>
                    ))}
                    <td colSpan={2} style={{ padding: '9px 10px', color: 'white', textAlign: 'right', borderLeft: '1px solid #3A414B' }}>
                      {items_lote.filter(i => lotes.some(l => l.id === i.lote_id)).reduce((s,i) => s+Number(i.cantidad||0), 0).toLocaleString('es-CO')}
                    </td>
                    {(() => {
                      const totC = itsContr.reduce((s, it) => s + (contratadoDe(it) ?? 0), 0)
                      const totD = itsContr.reduce((s, it) => s + cantDespTotal(it.id), 0)
                      const totF = totC - totD
                      return <>
                        <td style={{ padding: '9px 10px', textAlign: 'right', color: '#86EFAC', fontWeight: 700, borderLeft: '2px solid #3A414B' }}>
                          {totD.toLocaleString('es-CO')}
                        </td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', color: totF === 0 ? '#86EFAC' : '#FDBA74', fontWeight: 700 }}>
                          {totF === 0 ? '✓' : totF.toLocaleString('es-CO')}
                        </td>
                      </>
                    })()}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Modal completar lote con saldo */}
        {modalCierre && (() => {
          const { lote: loteM, soloAjuste } = modalCierre
          const saldos = saldosLote(loteM)
          const sigs   = siguientesAbiertos(loteM)
          const otraTorre = multi && sigs.length > 0 && torreDe(sigs[0]) !== torreDe(loteM)
          return (
            <Modal title={soloAjuste ? `Pasar saldo de ${loteM.nombre}` : `Completar ${loteM.nombre}`} onClose={() => setModalCierre(null)} wide>
              <p style={{ fontSize: 13, color: C.g5, marginBottom: 12 }}>
                {soloAjuste
                  ? 'Se pasan solo los excesos: el ítem queda con lo que realmente se despachó y esa cantidad de más se descuenta de los lotes siguientes. Lo que falta se queda en este lote y se sigue despachando.'
                  : 'Este lote no cuadra exacto con lo despachado. Revisa las diferencias:'}
              </p>
              <div style={{ ...card, padding: 0, display: 'block', width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: C.g1 }}>
                      <th style={{ padding: '7px 10px', textAlign: 'left' }}>REF</th>
                      <th style={{ padding: '7px 10px', textAlign: 'left' }}>DESCRIPCIÓN</th>
                      <th style={{ padding: '7px 10px', textAlign: 'right' }}>PLAN</th>
                      <th style={{ padding: '7px 10px', textAlign: 'right' }}>DESPACHADO</th>
                      <th style={{ padding: '7px 10px', textAlign: 'right' }}>SALDO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(soloAjuste ? saldos.filter(x => x.saldo < 0) : saldos).map(s => (
                      <tr key={s.il.id} style={{ borderTop: `1px solid ${C.g1}` }}>
                        <td style={{ padding: '6px 10px', fontWeight: 700, color: '#1D4ED8' }}>{s.it?.ref}</td>
                        <td style={{ padding: '6px 10px' }}>{s.it?.descripcion}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{s.plan.toLocaleString('es-CO')}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{s.desp.toLocaleString('es-CO')}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: s.saldo > 0 ? C.or : C.rd }}>
                          {s.saldo > 0 ? `Faltan ${s.saldo.toLocaleString('es-CO')}` : `Exceso ${Math.abs(s.saldo).toLocaleString('es-CO')}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sigs.length > 0 ? (
                <div style={{ background: '#EFF6FF', border: '1px solid #F3D3B5', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#2B313A', marginBottom: 16 }}>
                  {soloAjuste
                    ? <>Los excesos se descuentan de <strong>{destinoLabel(loteM, sigs[0])}</strong> y, si no alcanza, de los lotes que siguen.</>
                    : <>Si pasas el saldo: este lote queda con lo que realmente se despachó, lo que faltó se suma a <strong>{destinoLabel(loteM, sigs[0])}</strong> y los excesos se descuentan de los lotes siguientes.</>}
                  {otraTorre && (
                    <div style={{ marginTop: 6, color: '#9A3412', fontWeight: 600 }}>
                      ↪ El excedente pasa a {torres.find(t => t.id === torreDe(sigs[0]))?.nombre}: se parte la remisión y esa cantidad queda como despacho de esa torre, con nota de dónde salió. El plan, el contratado y el total de esa torre no cambian.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ background: C.rdL, border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.rd, marginBottom: 16 }}>
                  ⚠️ No hay lotes abiertos después de este, ni en esta torre ni en las que siguen. El saldo queda pendiente en la columna "Falta despachar".
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <Btn onClick={() => setModalCierre(null)}>Cancelar</Btn>
                {!soloAjuste && <Btn onClick={() => completarLote(loteM, false)} disabled={saving}>Solo completar</Btn>}
                {sigs.length > 0 && (
                  <Btn variant="primary" onClick={() => completarLote(loteM, true, !soloAjuste, soloAjuste)} disabled={saving}>
                    {saving ? 'Guardando…' : soloAjuste ? `Pasar excesos a ${destinoLabel(loteM, sigs[0])}` : `Completar y pasar saldo a ${destinoLabel(loteM, sigs[0])}`}
                  </Btn>
                )}
              </div>
            </Modal>
          )
        })()}

        {/* Modal definir lotes */}
        {modalLotes && (
          <Modal title="Definir lotes de producción" onClose={() => setModalLotes(false)}>
            <p style={{ fontSize: 13, color: C.g5, marginBottom: 16 }}>
              Define cuántos lotes tiene este contrato{multi ? <> para <strong>{torres.find(t => t.id === tP)?.nombre}</strong> (con lo que le tocó a esa torre en el reparto)</> : null}. El sistema dividirá las cantidades automáticamente.<br/>
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
          {nav?.desde === 'proyecto' && irA && <Btn variant="primary" onClick={() => irA('proyectos', { proyectoId: nav.proyectoId })}>← Volver al proyecto</Btn>}
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
                      {verValorContrato && <span style={{ fontSize: 12, color: C.g5, marginLeft: 12 }}>{fmt(c.valor_total)}</span>}
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
                  <div key={p.id} style={{ ...card, cursor: 'pointer', borderLeft: `4px solid #2B313A` }}
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
