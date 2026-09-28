// ═══════════════════════════════════════════════════════════════
// Cuánto hay despachado, instalado y facturado de cada ítem.
//
// Vivía dentro de Facturación. Se sacó acá porque el Dashboard necesita lo mismo
// para su resumen, y tener el cálculo escrito dos veces es como se cuelan los
// errores: se arregla en un lado y el otro sigue mintiendo.
//
// Se usa así:  const { cantBase, factItem, ... } = crearCalculos(dbData)
// ═══════════════════════════════════════════════════════════════

export function crearCalculos(dbData) {
  const {
    proyectos = [], contratos = [], items_contrato = [],
    actas_facturacion = [], items_acta_facturacion = [],
    subitems_instalacion = [], obras = [],
  } = dbData

  // ── Helpers ───────────────────────────────────────────────
  const totalFactContrato = cid =>
    actas_facturacion.filter(a => a.contrato_id === cid).reduce((s, a) => s + (Number(a.total) || 0), 0)

  // Cantidad despachada de un ítem (desde remisiones)
  const cantDespachada = (itemContratoId, torreId = '') => {
    const rems = torreId ? (dbData.remisiones || []).filter(r => r.obra_id === torreId).map(r => r.id) : null
    return (dbData.items_remision || [])
      .filter(i => i.item_contrato_id === itemContratoId && (!rems || rems.includes(i.remision_id)))
      .reduce((s, i) => s + Number(i.cantidad || 0), 0)
  }

  // Instalado a hoy de un ítem de instalación, leído de Gestión de Obras:
  // cuenta una unidad por apto cuando todas sus partes están chuleadas.
  // Torres (obras de Gestión) de un proyecto
  const torresDe = proy => [...new Set([...(proy?.obras_ids || []), proy?.obra_id].filter(Boolean))]
    .map(id => obras.find(o => o.id === id)).filter(Boolean)
  const nombreTorre = id => obras.find(o => o.id === id)?.nombre || ''

  // torreId vacío = todas las torres del proyecto
  // Elementos que este ítem NO comparte con otros ítems del mismo contrato. La chapa,
  // por ejemplo, va en varias puertas: si se usara para decidir si un ítem aplica en un
  // apto, un apto con chapa pero sin la puerta de reforma daría esa puerta por instalada.
  const elsPropiosDeItem = (itemContratoId, cid) => {
    const mios = subitems_instalacion.filter(p => p.item_contrato_id === itemContratoId && p.elemento_id).map(p => p.elemento_id)
    if (!mios.length) return mios
    const otrosItems = items_contrato.filter(i => i.contrato_id === cid && i.id !== itemContratoId).map(i => i.id)
    const otros = new Set(subitems_instalacion.filter(p => otrosItems.includes(p.item_contrato_id) && p.elemento_id).map(p => p.elemento_id))
    const propios = mios.filter(eid => !otros.has(eid))
    return propios.length ? propios : mios   // si todo es compartido, no hay con qué distinguir
  }

  const instaladoItem = (itemContratoId, torreId = '') => {
    const it = items_contrato.find(i => i.id === itemContratoId)
    const c = contratos.find(x => x.id === it?.contrato_id)
    const proy = proyectos.find(p => p.id === c?.proyecto_id)
    const torres = torresDe(proy).filter(t => !torreId || t.id === torreId)
    if (!torres.length) return 0
    const eids = subitems_instalacion.filter(p => p.item_contrato_id === itemContratoId && p.elemento_id).map(p => p.elemento_id)
    if (!eids.length) return 0
    const propios = elsPropiosDeItem(itemContratoId, c?.id)
    return torres.flatMap(t => (t.pisos || []).flatMap(p => p.aptos || [])).reduce((s, a) => {
      const todos = [...(a.elementos || []), ...(a.elementosExtra || [])]
      const hay = eid => todos.some(e => e.elementoId === eid)
      if (!propios.some(hay)) return s        // el apto no lleva este ítem
      const presentes = eids.filter(hay)
      if (!presentes.length) return s
      let min = Infinity
      for (const eid of presentes) {
        min = Math.min(min, todos.filter(e => e.elementoId === eid && e.completado).reduce((x, e) => x + Number(e.cantidad || 1), 0))
      }
      return s + (min === Infinity ? 0 : min)
    }, 0)
  }

  // Facturado de un ítem: todas las actas, o solo las de una torre
  const factItem = (itemId, torreId = '') => {
    const actas = torreId ? actas_facturacion.filter(a => a.obra_id === torreId).map(a => a.id) : null
    return items_acta_facturacion
      .filter(r => r.item_contrato_id === itemId && (!actas || actas.includes(r.acta_facturacion_id)))
      .reduce((s, r) => s + Number(r.cantidad || 0), 0)
  }

  const esInstalacion = c => c?.tipo === 'instalacion'
  const contratoDeItem = itemId => contratos.find(c => c.id === items_contrato.find(i => i.id === itemId)?.contrato_id)
  // Lo que se puede facturar: en suministro lo despachado, en instalación lo instalado
  // ── Avance real (parcial) ─────────────────────────────────
  // Igual que en Instalación: cada parte pesa lo que se le paga al instalador, así que
  // una puerta puesta sin chapa cuenta como fracción y no como cero. Las obras abonan
  // por ese avance, así que es la base para facturar.
  const pesoParte = p => (Number(p.valor_instalador) || 0) + (Number(p.valor_detallado) || 0)
  const pesosDeItem = itemContratoId => {
    const ps = subitems_instalacion.filter(p => p.item_contrato_id === itemContratoId && p.elemento_id)
    const total = ps.reduce((s, p) => s + pesoParte(p), 0)
    const m = {}
    ps.forEach(p => { m[p.elemento_id] = total > 0 ? pesoParte(p) / total : 1 / (ps.length || 1) })
    return m
  }
  const avanceItem = (itemContratoId, torreId = '') => {
    const it = items_contrato.find(i => i.id === itemContratoId)
    const c = contratos.find(x => x.id === it?.contrato_id)
    const proy = proyectos.find(p => p.id === c?.proyecto_id)
    const torres = torresDe(proy).filter(t => !torreId || t.id === torreId)
    if (!torres.length) return 0
    const eids = subitems_instalacion.filter(p => p.item_contrato_id === itemContratoId && p.elemento_id).map(p => p.elemento_id)
    if (!eids.length) return 0
    const propios = elsPropiosDeItem(itemContratoId, c?.id)
    const pesos = pesosDeItem(itemContratoId)
    return torres.flatMap(t => (t.pisos || []).flatMap(p => p.aptos || [])).reduce((s, a) => {
      const todos = [...(a.elementos || []), ...(a.elementosExtra || [])]
      const hay = eid => todos.some(e => e.elementoId === eid)
      if (!propios.some(hay)) return s
      return s + eids.filter(hay).reduce((x, eid) => {
        const hechas = todos.filter(e => e.elementoId === eid && e.completado)
          .reduce((y, e) => y + Number(e.cantidad || 1), 0)
        return x + hechas * (pesos[eid] || 0)
      }, 0)
    }, 0)
  }
  // Base para facturar: en instalación es el avance real; en suministro, lo despachado.
  const cantBase = (itemId, torreId = '') => esInstalacion(contratoDeItem(itemId)) ? avanceItem(itemId, torreId) : cantDespachada(itemId, torreId)
  const nombreBase = c => esInstalacion(c) ? 'instalado' : 'despachado'


  return {
    totalFactContrato, cantDespachada, torresDe, nombreTorre, elsPropiosDeItem,
    instaladoItem, factItem, esInstalacion, contratoDeItem,
    pesoParte, pesosDeItem, avanceItem, cantBase, nombreBase,
  }
}
