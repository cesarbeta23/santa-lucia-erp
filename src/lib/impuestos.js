// ═══════════════════════════════════════════════════════════════
// Cálculo de utilidad e IVA de un contrato
//
// Suministro: IVA 19% sobre el subtotal.
// Instalación: el IVA es el 19% de la UTILIDAD, y cada constructora la
// maneja distinto, así que se configura por contrato:
//   · pct_utilidad   → porcentaje de utilidad (por defecto 10)
//   · modo_utilidad  →
//       'iva_sobre_utilidad' → utilidad = subtotal × %, NO se suma al total
//                               total = subtotal + IVA
//       'sumada'             → utilidad = subtotal × %, SÍ se suma
//                               total = subtotal + utilidad + IVA   (ej. Nomad / Colpatria)
//       'incluida'           → la utilidad ya está dentro del precio:
//                               utilidad = subtotal × %/(100+%), NO se suma
//                               total = subtotal + IVA               (ej. Selva / Monserrate)
// ═══════════════════════════════════════════════════════════════

// ── Tasas configurables ────────────────────────────────────
// Salen del módulo de Configuración y se fijan una sola vez, cuando la app
// carga los datos (antes de que cualquier pantalla pinte números). Se guardan
// acá para no tener que pasar el IVA por parámetro en las ~10 llamadas.
let IVA_PCT      = 19
let UTILIDAD_PCT = 10

export function setTasas({ iva, utilidad } = {}) {
  if (Number.isFinite(Number(iva)))      IVA_PCT      = Number(iva)
  if (Number.isFinite(Number(utilidad))) UTILIDAD_PCT = Number(utilidad)
}
export const ivaPct      = () => IVA_PCT
export const utilidadPct = () => UTILIDAD_PCT

export const MODOS_UTILIDAD = {
  iva_sobre_utilidad: 'IVA sobre la utilidad (la utilidad no se suma)',
  sumada:             'Utilidad discriminada y sumada al total',
  incluida:           'Utilidad incluida en los precios',
}

export function totalesContrato(subtotal, contrato) {
  const sub = Number(subtotal) || 0
  if (contrato?.tipo !== 'instalacion') {
    const iva = sub * (IVA_PCT / 100)
    return { subtotal: sub, utilidad: 0, iva, total: sub + iva, sumaUtilidad: false, pct: 0, modo: null }
  }
  const pct  = contrato?.pct_utilidad === null || contrato?.pct_utilidad === undefined || contrato?.pct_utilidad === ''
    ? UTILIDAD_PCT : Number(contrato.pct_utilidad)
  const p    = pct / 100
  const modo = contrato?.modo_utilidad || 'iva_sobre_utilidad'
  const utilidad = modo === 'incluida' ? sub * p / (1 + p) : sub * p
  const iva = utilidad * (IVA_PCT / 100)
  const sumaUtilidad = modo === 'sumada'
  const total = sub + iva + (sumaUtilidad ? utilidad : 0)
  return { subtotal: sub, utilidad, iva, total, sumaUtilidad, pct, modo }
}

// Texto corto para mostrar junto al IVA
export function etiquetaIva(contrato) {
  if (contrato?.tipo !== 'instalacion') return `IVA ${IVA_PCT}%`
  const t = totalesContrato(100, contrato)
  const pct = Number(t.pct.toFixed(4))
  if (t.modo === 'incluida') return `IVA ${IVA_PCT}% sobre utilidad ${pct}% incluida en precios`
  return `IVA ${IVA_PCT}% sobre utilidad ${pct}%`
}
