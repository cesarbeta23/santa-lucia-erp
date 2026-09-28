import * as XLSX from 'xlsx'
import { C, Stat, Btn, card, fmt, Badge, empresaDe, porNombre } from '../components/UI.jsx'
import { crearCalculos } from '../lib/avance.js'
import { totalesContrato } from '../lib/impuestos.js'

// ── Resumen de todas las obras a Excel ─────────────────────
// Tres cifras por contrato, todas CON IVA para que se comparen parejo:
//   Contratado   → el valor total del contrato
//   Facturado    → la suma de sus actas
//   Por facturar → lo despachado (o instalado, si es contrato de instalación)
//                  menos lo ya facturado. NO es contratado − facturado: es lo que
//                  se puede cobrar hoy, el mismo número del informe de Facturación.
// Un ítem sobrefacturado cuenta como cero, no resta: igual que allá.
function exportarResumen(dbData) {
  const { proyectos = [], contratos = [], items_contrato = [], constructoras = [] } = dbData
  const k = crearCalculos(dbData)
  const hoy = new Date().toLocaleDateString('es-CO')

  const cifras = c => {
    const its = items_contrato.filter(i => i.contrato_id === c.id)
    const subPend = its.reduce((s, i) =>
      s + Math.max(0, k.cantBase(i.id) - k.factItem(i.id)) * (Number(i.vr_unitario) || 0), 0)
    return {
      contratado: Number(c.valor_total) || 0,
      facturado: k.totalFactContrato(c.id),
      porFacturar: subPend > 0 ? totalesContrato(subPend, c).total : 0,
    }
  }

  const TIPO = { suministro: 'Suministro', instalacion: 'Instalación', todo_costo: 'Todo costo' }
  // El todo costo se suma con suministro: se factura contra lo despachado, igual que él.
  const esInst = c => c.tipo === 'instalacion'
  const nomConstr = id => constructoras.find(x => x.id === id)?.nombre || '—'
  const cap = t => t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : '—'

  // ── Hoja 1: una fila por obra ──
  const filas = [...proyectos].sort(porNombre).map(p => {
    const cs = contratos.filter(c => c.proyecto_id === p.id)
    const suma = lista => lista.map(cifras).reduce((a, x) => ({
      contratado: a.contratado + x.contratado, facturado: a.facturado + x.facturado,
      porFacturar: a.porFacturar + x.porFacturar,
    }), { contratado: 0, facturado: 0, porFacturar: 0 })
    const sum = suma(cs.filter(c => !esInst(c)))
    const ins = suma(cs.filter(esInst))
    const tipos = [...new Set(cs.map(c => TIPO[c.tipo] || c.tipo))].join(', ') || 'Sin contrato'
    return { obra: p.nombre, constr: nomConstr(p.constructora_id), estado: cap(p.estado), tipos, sum, ins }
  })

  const cab = ['', '', '', '', 'SUMINISTRO', '', '', 'INSTALACIÓN', '', '', 'TOTAL', '', '', '']
  const sub = ['Obra', 'Constructora', 'Estado', 'Contratos',
    'Contratado', 'Facturado', 'Por facturar',
    'Contratado', 'Facturado', 'Por facturar',
    'Contratado', 'Facturado', 'Por facturar', '% fact.']

  const aoa1 = [
    [`Resumen de obras — ${empresaDe(dbData).empresa}`],
    [`Generado el ${hoy}. Valores con IVA. "Por facturar" es lo despachado o instalado que aún no se ha facturado.`],
    [],
    cab, sub,
  ]
  filas.forEach(f => aoa1.push([
    f.obra, f.constr, f.estado, f.tipos,
    f.sum.contratado, f.sum.facturado, f.sum.porFacturar,
    f.ins.contratado, f.ins.facturado, f.ins.porFacturar,
    null, null, null, null,   // se llenan con fórmula más abajo
  ]))
  const filaTot = aoa1.length + 1
  aoa1.push(['TOTAL', '', '', '', null, null, null, null, null, null, null, null, null, null])

  const h1 = XLSX.utils.aoa_to_sheet(aoa1)
  const pf = 6                       // primera fila de datos (1-based)
  const ul = pf + filas.length - 1   // última fila de datos
  // Los totales por obra y la fila final van como fórmula: si filtras o editas, cuadran solos.
  for (let r = pf; r <= ul; r++) {
    h1[`K${r}`] = { t: 'n', f: `E${r}+H${r}`, z: '"$"#,##0' }
    h1[`L${r}`] = { t: 'n', f: `F${r}+I${r}`, z: '"$"#,##0' }
    h1[`M${r}`] = { t: 'n', f: `G${r}+J${r}`, z: '"$"#,##0' }
    h1[`N${r}`] = { t: 'n', f: `IFERROR(L${r}/K${r},0)`, z: '0.0%' }
    for (const col of ['E', 'F', 'G', 'H', 'I', 'J']) {
      const cel = h1[`${col}${r}`]; if (cel) cel.z = '"$"#,##0'
    }
  }
  for (const col of ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
    h1[`${col}${filaTot}`] = { t: 'n', f: `SUM(${col}${pf}:${col}${ul})`, z: '"$"#,##0' }
  }
  h1[`N${filaTot}`] = { t: 'n', f: `IFERROR(L${filaTot}/K${filaTot},0)`, z: '0.0%' }
  h1['!cols'] = [{ wch: 26 }, { wch: 24 }, { wch: 10 }, { wch: 22 },
    ...Array(9).fill({ wch: 16 }), { wch: 9 }]
  h1['!merges'] = [
    { s: { r: 3, c: 4 }, e: { r: 3, c: 6 } },
    { s: { r: 3, c: 7 }, e: { r: 3, c: 9 } },
    { s: { r: 3, c: 10 }, e: { r: 3, c: 12 } },
  ]

  // ── Hoja 2: una fila por contrato ──
  const aoa2 = [
    [`Contratos — ${empresaDe(dbData).empresa}`],
    [`Generado el ${hoy}. Valores con IVA.`],
    [],
    ['Obra', 'Constructora', 'Tipo', 'N° contrato', 'Estado', 'Contratado', 'Facturado', 'Por facturar', '% fact.', 'Actas'],
  ]
  const ordenados = contratos.map(c => {
    const p = proyectos.find(x => x.id === c.proyecto_id)
    return { c, obra: p?.nombre || '—', constr: nomConstr(p?.constructora_id) }
  }).sort((a, b) => a.obra.localeCompare(b.obra, 'es', { numeric: true }) || String(a.c.tipo).localeCompare(String(b.c.tipo)))

  ordenados.forEach(({ c, obra, constr }) => {
    const x = cifras(c)
    const nActas = (dbData.actas_facturacion || []).filter(a => a.contrato_id === c.id).length
    aoa2.push([obra, constr, TIPO[c.tipo] || c.tipo, c.numero || '—', cap(c.estado),
      x.contratado, x.facturado, x.porFacturar, null, nActas])
  })
  const h2 = XLSX.utils.aoa_to_sheet(aoa2)
  const pf2 = 5, ul2 = pf2 + ordenados.length - 1
  for (let r = pf2; r <= ul2; r++) {
    for (const col of ['F', 'G', 'H']) { const cel = h2[`${col}${r}`]; if (cel) cel.z = '"$"#,##0' }
    h2[`I${r}`] = { t: 'n', f: `IFERROR(G${r}/F${r},0)`, z: '0.0%' }
  }
  const fT2 = ul2 + 1
  h2[`A${fT2}`] = { t: 's', v: 'TOTAL' }
  for (const col of ['F', 'G', 'H']) h2[`${col}${fT2}`] = { t: 'n', f: `SUM(${col}${pf2}:${col}${ul2})`, z: '"$"#,##0' }
  h2['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: fT2 - 1, c: 9 } })
  h2['!cols'] = [{ wch: 26 }, { wch: 24 }, { wch: 13 }, { wch: 13 }, { wch: 10 },
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 9 }, { wch: 8 }]

  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, h1, 'Resumen por obra')
  XLSX.utils.book_append_sheet(libro, h2, 'Contratos')
  XLSX.writeFile(libro, `Resumen obras ${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export default function Dashboard({ dbData, user, puedeIr, irA }) {
  const verFact = puedeIr ? puedeIr('facturacion') : false
  const verContr = puedeIr ? puedeIr('contratos') : false
  const { proyectos = [], contratos = [], actas_facturacion = [] } = dbData

  const totalContratos = contratos.reduce((s, c) => s + (Number(c.valor_total) || 0), 0)
  const totalFacturado = actas_facturacion.reduce((s, a) => s + (Number(a.total) || 0), 0)
  const pendFact = totalContratos - totalFacturado
  const pct = totalContratos > 0 ? Math.round(totalFacturado / totalContratos * 100) : 0
  const activos = [...proyectos.filter(p => p.estado === 'activo')].sort((a, b) => a.nombre.localeCompare(b.nombre))

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-.02em' }}>
            Hola, {user.nombre?.split(' ')[0]} 👋
          </h1>
          <p style={{ color: C.g5, marginTop: 4, fontSize: 14 }}>
            Resumen general — {empresaDe(dbData).empresa}
          </p>
        </div>
        {verFact && (
          <Btn variant="primary" onClick={() => exportarResumen(dbData)}>📊 Bajar resumen en Excel</Btn>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${verFact ? 4 : verContr ? 2 : 1}, 1fr)`, gap: 14, marginBottom: 28 }}>
        <Stat label="Proyectos activos"  value={activos.length} color={C.or} />
        {verContr && <Stat label="Total contratos" value={fmt(totalContratos)} />}
        {verFact && <Stat label="Facturado"    value={fmt(totalFacturado)} color={C.gnD} sub={`${pct}% del total`} />}
        {verFact && <Stat label="Por facturar" value={fmt(pendFact)} color={pendFact > 0 ? C.am : C.gnD} />}
      </div>

      <h3 style={{ fontSize: 11, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>
        Proyectos activos ({activos.length})
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 12 }}>
        {activos.map(p => {
          const cs = contratos.filter(c => c.proyecto_id === p.id)
          const valor = cs.reduce((s, c) => s + (Number(c.valor_total) || 0), 0)
          const fact = actas_facturacion.filter(a => cs.some(c => c.id === a.contrato_id)).reduce((s, a) => s + (Number(a.total) || 0), 0)
          const pctP = valor > 0 ? Math.min(100, Math.round(fact / valor * 100)) : 0
          const constr = (dbData.constructoras || []).find(c => c.id === p.constructora_id)?.nombre
          const tipos = [...new Set(cs.map(c => c.tipo))]
          const torres = [...new Set([...(p.obras_ids || []), p.obra_id].filter(Boolean))].length
          const puedeAbrir = irA && puedeIr && puedeIr('proyectos')
          return (
            <div key={p.id} onClick={() => puedeAbrir && irA('proyectos', { proyectoId: p.id })}
              style={{ ...card, padding: '14px 16px', cursor: puedeAbrir ? 'pointer' : 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{p.nombre}{puedeAbrir && <span style={{ color: C.g4, marginLeft: 6 }}>›</span>}</div>
                  <div style={{ fontSize: 11, color: C.g5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {constr || 'Sin constructora'}{torres > 1 ? ` · ${torres} torres` : ''}
                  </div>
                </div>
                {cs.length === 0
                  ? <Badge color="amber">Sin contrato</Badge>
                  : <div style={{ display: 'flex', gap: 4 }}>
                      {tipos.map(t => (
                        <span key={t} title={t} style={{ fontSize: 14 }}>{t === 'suministro' ? '📦' : t === 'instalacion' ? '🔧' : '📋'}</span>
                      ))}
                    </div>}
              </div>

              {verContr && valor > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: C.g5 }}>Contratado</span>
                    <strong>{fmt(valor)}</strong>
                  </div>
                  {verFact && <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: C.g5 }}>Facturado</span>
                      <span style={{ color: C.gnD, fontWeight: 600 }}>{fmt(fact)} · {pctP}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                      <span style={{ color: C.g5 }}>Por facturar</span>
                      <span style={{ color: C.or, fontWeight: 600 }}>{fmt(valor - fact)}</span>
                    </div>
                    <div style={{ height: 5, background: C.g1, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pctP}%`, height: '100%', background: C.gnD }} />
                    </div>
                  </>}
                </>
              )}
            </div>
          )
        })}
        {activos.length === 0 && (
          <div style={{ ...card, textAlign: 'center', color: C.g4, padding: '2rem', fontSize: 13 }}>
            Sin proyectos activos aún
          </div>
        )}
      </div>
    </div>
  )
}
