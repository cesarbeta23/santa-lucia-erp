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

export const MODOS_UTILIDAD = {
  iva_sobre_utilidad: 'IVA sobre la utilidad (la utilidad no se suma)',
  sumada:             'Utilidad discriminada y sumada al total',
  incluida:           'Utilidad incluida en los precios',
}

export function totalesContrato(subtotal, contrato) {
  const sub = Number(subtotal) || 0
  if (contrato?.tipo !== 'instalacion') {
    const iva = sub * 0.19
    return { subtotal: sub, utilidad: 0, iva, total: sub + iva, sumaUtilidad: false, pct: 0, modo: null }
  }
  const pct  = contrato?.pct_utilidad === null || contrato?.pct_utilidad === undefined || contrato?.pct_utilidad === ''
    ? 10 : Number(contrato.pct_utilidad)
  const p    = pct / 100
  const modo = contrato?.modo_utilidad || 'iva_sobre_utilidad'
  const utilidad = modo === 'incluida' ? sub * p / (1 + p) : sub * p
  const iva = utilidad * 0.19
  const sumaUtilidad = modo === 'sumada'
  const total = sub + iva + (sumaUtilidad ? utilidad : 0)
  return { subtotal: sub, utilidad, iva, total, sumaUtilidad, pct, modo }
}

// Texto corto para mostrar junto al IVA
export function etiquetaIva(contrato) {
  if (contrato?.tipo !== 'instalacion') return 'IVA 19%'
  const t = totalesContrato(100, contrato)
  const pct = Number(t.pct.toFixed(4))
  if (t.modo === 'incluida') return `IVA 19% sobre utilidad ${pct}% incluida en precios`
  return `IVA 19% sobre utilidad ${pct}%`
}
