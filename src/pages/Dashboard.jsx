import { C, Stat, card, fmt, Badge, empresaDe } from '../components/UI.jsx'

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
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-.02em' }}>
          Hola, {user.nombre?.split(' ')[0]} 👋
        </h1>
        <p style={{ color: C.g5, marginTop: 4, fontSize: 14 }}>
          Resumen general — {empresaDe(dbData).empresa}
        </p>
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
