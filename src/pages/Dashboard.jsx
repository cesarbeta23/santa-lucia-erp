import { C, Stat, card, fmt, Badge } from '../components/UI.jsx'

export default function Dashboard({ dbData, user, puedeIr, irA }) {
  const verFact = puedeIr ? puedeIr('facturacion') : false
  const verContr = puedeIr ? puedeIr('contratos') : false
  const { proyectos = [], contratos = [], actas_facturacion = [], adicionales = [] } = dbData

  const totalContratos = contratos.reduce((s, c) => s + (Number(c.valor_total) || 0), 0)
  const totalFacturado = actas_facturacion.reduce((s, a) => s + (Number(a.total) || 0), 0)
  const pendFact = totalContratos - totalFacturado
  const adPendientes = adicionales.filter(a => a.estado === 'pendiente').length
  const pct = totalContratos > 0 ? Math.round(totalFacturado / totalContratos * 100) : 0

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-.02em' }}>
          Hola, {user.nombre?.split(' ')[0]} 👋
        </h1>
        <p style={{ color: C.g5, marginTop: 4, fontSize: 14 }}>
          Resumen general — Santa Lucía Muebles y Pisos S.A.S.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${verFact ? 4 : verContr ? 2 : 1}, 1fr)`, gap: 14, marginBottom: 28 }}>
        <Stat label="Proyectos activos"  value={proyectos.filter(p => p.estado === 'activo').length} color={C.or} />
        {verContr && <Stat label="Total contratos" value={fmt(totalContratos)} />}
        {verFact && <Stat label="Facturado"    value={fmt(totalFacturado)} color={C.gnD} sub={`${pct}% del total`} />}
        {verFact && <Stat label="Por facturar" value={fmt(pendFact)} color={pendFact > 0 ? C.am : C.gnD} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <h3 style={{ fontSize: 11, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>
            Proyectos activos ({proyectos.filter(p => p.estado === 'activo').length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...proyectos.filter(p => p.estado === 'activo')].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(p => {
              const cs = contratos.filter(c => c.proyecto_id === p.id)
              const valor = cs.reduce((s, c) => s + (Number(c.valor_total) || 0), 0)
              const fact = actas_facturacion.filter(a => cs.some(c => c.id === a.contrato_id)).reduce((s, a) => s + (Number(a.total) || 0), 0)
              const pctP = valor > 0 ? Math.min(100, Math.round(fact / valor * 100)) : 0
              const constr = (dbData.constructoras || []).find(c => c.id === p.constructora_id)?.nombre
              const puedeAbrir = irA && puedeIr && puedeIr('proyectos')
              return (
                <div key={p.id} onClick={() => puedeAbrir && irA('proyectos', { proyectoId: p.id })}
                  style={{ ...card, padding: '9px 14px', cursor: puedeAbrir ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.nombre}{puedeAbrir && <span style={{ color: C.g4, marginLeft: 6 }}>›</span>}</div>
                      <div style={{ fontSize: 11, color: C.g5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {constr ? `${constr} · ` : ''}{cs.length ? `${cs.length} contrato(s)` : 'sin contratos'}
                      </div>
                    </div>
                    {verContr && valor > 0 && <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {fmt(valor)}
                      {verFact && <div style={{ fontSize: 10, color: C.gnD, fontWeight: 600 }}>{pctP}% facturado</div>}
                    </div>}
                    {!cs.length && <Badge color="amber">Sin contrato</Badge>}
                  </div>
                  {verFact && valor > 0 && (
                    <div style={{ height: 4, background: C.g1, borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${pctP}%`, height: '100%', background: C.gnD }} />
                    </div>
                  )}
                </div>
              )
            })}
            {proyectos.filter(p => p.estado === 'activo').length === 0 && (
              <div style={{ ...card, textAlign: 'center', color: C.g4, padding: '2rem', fontSize: 13 }}>
                Sin proyectos activos aún
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: 11, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>
            Alertas y pendientes
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {adPendientes > 0 && (
              <div style={{ ...card, borderLeft: `4px solid ${C.am}`, display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px' }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{adPendientes} adicional(es) pendiente(s)</div>
                  <div style={{ fontSize: 12, color: C.g5 }}>Requieren aprobación</div>
                </div>
              </div>
            )}
            {adicionales.filter(a => a.cobrar_a_obra && !a.aprobado).length > 0 && (
              <div style={{ ...card, borderLeft: `4px solid ${C.or}`, display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px' }}>
                <span style={{ fontSize: 20 }}>💰</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {adicionales.filter(a => a.cobrar_a_obra && !a.aprobado).length} adicional(es) por cobrar a obra
                  </div>
                  <div style={{ fontSize: 12, color: C.g5 }}>Pendientes de gestionar</div>
                </div>
              </div>
            )}
            {adPendientes === 0 && adicionales.filter(a => a.cobrar_a_obra && !a.aprobado).length === 0 && (
              <div style={{ ...card, textAlign: 'center', color: C.gnD, padding: '2rem', fontSize: 14 }}>
                ✓ Sin alertas pendientes
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
