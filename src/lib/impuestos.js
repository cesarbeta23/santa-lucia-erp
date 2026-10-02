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

// Cálculo con los precios SIN impuesto: a la base se le suma lo que corresponda.
function sobreLaBase(sub, contrato) {
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

// Cuánto vale un peso de precio una vez se le suma todo. Es el número por el que
// hay que dividir cuando el impuesto ya viene adentro.
function factorDe(contrato) {
  const f = Number(contrato?.factor_iva)
  if (Number.isFinite(f) && f > 0) return f
  // Sin factor guardado, el que sale de las tasas de hoy.
  const t = sobreLaBase(1, contrato)
  return t.total > 0 ? t.total : 1
}

export function totalesContrato(subtotal, contrato) {
  const sub = Number(subtotal) || 0
  const base = sobreLaBase(sub, contrato)
  if (!contrato?.iva_incluido) return base

  // Los precios de este contrato YA traen el impuesto adentro (así los pactó la
  // obra y así se montaron). Entonces lo que llega no es una base a la que haya
  // que sumarle nada: es el total, y el impuesto se SACA de ahí.
  //
  // Contratos ya lo hacía así por su cuenta, pero esta función no, y Facturación
  // y el Dashboard la usan directo. Por eso un acta de un contrato con IVA
  // incluido salía con el 19% puesto dos veces y el acumulado se inflaba.
  const factor = factorDe(contrato)
  const iva = factor > 0 ? sub * (1 - 1 / factor) : 0
  return {
    subtotal: sub - iva,        // la base que queda al descontar el impuesto
    utilidad: 0,                // ya está adentro del precio, no se discrimina
    iva,
    total: sub,                 // el precio pactado, tal cual
    sumaUtilidad: false,
    pct: base.pct, modo: base.modo, ivaIncluido: true,
  }
}

// Texto corto para mostrar junto al IVA
export function etiquetaIva(contrato) {
  const inc = !!contrato?.iva_incluido
  if (contrato?.tipo !== 'instalacion') {
    return inc ? `IVA ${IVA_PCT}% (ya incluido en los precios)` : `IVA ${IVA_PCT}%`
  }
  const t = sobreLaBase(100, contrato)
  const pct = Number(t.pct.toFixed(4))
  const base = t.modo === 'incluida'
    ? `IVA ${IVA_PCT}% sobre utilidad ${pct}% incluida en precios`
    : `IVA ${IVA_PCT}% sobre utilidad ${pct}%`
  return inc ? `${base} (ya incluido en los precios)` : base
}

// ¿Los precios del contrato traen el impuesto adentro? Lo usan las pantallas
// para rotular bien las columnas.
export const conIvaIncluido = contrato => !!contrato?.iva_incluido
