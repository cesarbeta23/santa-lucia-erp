import { useState, useEffect } from 'react'
import { C, Btn, Inp, Toast, fmt } from './components/UI.jsx'
import { supabase } from './lib/supabase.js'

// ── Páginas (esqueleto — se llenan módulo por módulo) ──────
import Dashboard    from './pages/Dashboard.jsx'
import Comercial    from './pages/Comercial.jsx'
import Contratos    from './pages/Contratos.jsx'
import Proyectos    from './pages/Proyectos.jsx'
import Pedidos      from './pages/Pedidos.jsx'
import Produccion   from './pages/Produccion.jsx'
import Despachos    from './pages/Despachos.jsx'
import Facturacion  from './pages/Facturacion.jsx'
import Instalacion  from './pages/Instalacion.jsx'
import Adicionales  from './pages/Adicionales.jsx'
import Constructoras from './pages/Constructoras.jsx'
import Config       from './pages/Config.jsx'

// ── Roles ──────────────────────────────────────────────────
const ROLES = {
  SA: 'superadmin',
  SV: 'supervisor',
  AX: 'auxiliar',
  IN: 'instalador',
}

// ── Módulos del sidebar ────────────────────────────────────
const MODULES = [
  {
    section: 'Principal',
    items: [
      { key: 'dashboard',    label: 'Dashboard',       icon: '◼', roles: ['superadmin','supervisor','auxiliar'] },
    ],
  },
  {
    section: 'Comercial',
    items: [
      { key: 'comercial',    label: 'Cotizaciones',    icon: '📋', roles: ['superadmin','supervisor'] },
      { key: 'contratos',    label: 'Contratos',       icon: '📄', roles: ['superadmin','supervisor'] },
      { key: 'proyectos',    label: 'Proyectos',       icon: '🏗️', roles: ['superadmin','supervisor','auxiliar'] },
      { key: 'constructoras',label: 'Constructoras',   icon: '🏢', roles: ['superadmin'] },
    ],
  },
  {
    section: 'Operativo',
    items: [
      { key: 'pedidos',      label: 'Pedidos',         icon: '📦', roles: ['superadmin','supervisor','auxiliar'] },
      { key: 'produccion',   label: 'Producción',      icon: '🔨', roles: ['superadmin','supervisor','auxiliar'] },
      { key: 'despachos',    label: 'Despachos',       icon: '🚚', roles: ['superadmin','supervisor','auxiliar'] },
      { key: 'instalacion',  label: 'Instalación',     icon: '🔧', roles: ['superadmin','supervisor','auxiliar'] },
      { key: 'adicionales',  label: 'Adicionales',     icon: '➕', roles: ['superadmin','supervisor','auxiliar'] },
    ],
  },
  {
    section: 'Financiero',
    items: [
      { key: 'facturacion',  label: 'Facturación',     icon: '💰', roles: ['superadmin','supervisor'], restricted: true },
    ],
  },
  {
    section: 'Sistema',
    items: [
      { key: 'config',       label: 'Configuración',   icon: '⚙️', roles: ['superadmin'] },
    ],
  },
]

// ── Componente Login ───────────────────────────────────────
function Login({ onLogin }) {
  const [form, setForm] = useState({ email: '', pin: '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!form.email || !form.pin) { setErr('Ingresa correo y PIN'); return }
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('email', form.email)
        .eq('pin', form.pin)
        .single()

      if (error || !data) { setErr('Correo o PIN incorrecto'); return }
      onLogin(data)
    } catch {
      setErr('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: C.g9, fontFamily: 'inherit',
    }}>
      <div style={{
        background: C.wh, borderRadius: 20, padding: '2.5rem',
        width: 380, boxShadow: '0 24px 64px rgba(0,0,0,.4)',
        border: `1px solid ${C.g8}`,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, background: C.bk, borderRadius: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', border: `2px solid ${C.or}`,
          }}>
            <span style={{ fontSize: 28 }}>🪵</span>
          </div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.bk, letterSpacing: '-.02em' }}>
            Santa Lucía
          </div>
          <div style={{ fontSize: 13, color: C.g5, marginTop: 4 }}>
            Sistema de Información
          </div>
        </div>

        <Inp
          label="Correo"
          type="email"
          placeholder="usuario@obra.com"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
        />
        <Inp
          label="PIN"
          type="password"
          placeholder="••••"
          value={form.pin}
          onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
        />

        {err && (
          <p style={{ color: C.rd, fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{err}</p>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: '100%', padding: '12px', fontSize: 15, borderRadius: 10,
            fontWeight: 700, fontFamily: 'inherit', cursor: loading ? 'not-allowed' : 'pointer',
            background: C.or, border: 'none', color: C.wh,
            opacity: loading ? .7 : 1, transition: 'opacity .15s',
          }}
        >
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>

        <p style={{ textAlign: 'center', fontSize: 12, color: C.g4, marginTop: 20 }}>
          Santa Lucía Muebles y Pisos S.A.S.
        </p>
      </div>
    </div>
  )
}

// ── Sidebar ────────────────────────────────────────────────
function Sidebar({ user, view, setView, onLogout }) {
  const visibleModules = MODULES.map(sec => ({
    ...sec,
    items: sec.items.filter(it => it.roles.includes(user.rol)),
  })).filter(sec => sec.items.length > 0)

  return (
    <div style={{
      width: 220, background: C.bk, display: 'flex',
      flexDirection: 'column', height: '100vh',
      borderRight: `1px solid ${C.g8}`, flexShrink: 0,
    }}>
      {/* Logo sidebar */}
      <div style={{
        padding: '18px 16px 14px', borderBottom: `1px solid ${C.g8}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 34, height: 34, background: C.g8, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${C.or}`, fontSize: 16, flexShrink: 0,
        }}>🪵</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.wh }}>Santa Lucía</div>
          <div style={{ fontSize: 11, color: C.g5 }}>Muebles y Pisos</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
        {visibleModules.map(sec => (
          <div key={sec.section} style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: C.g7,
              textTransform: 'uppercase', letterSpacing: '.1em',
              padding: '0 8px', marginBottom: 6,
            }}>{sec.section}</div>
            {sec.items.map(item => {
              const active = view === item.key
              return (
                <button key={item.key} onClick={() => setView(item.key)} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '8px 10px', borderRadius: 8,
                  background: active ? C.g8 : 'transparent',
                  border: 'none', color: active ? C.wh : C.g4,
                  fontSize: 13, fontWeight: active ? 600 : 400,
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'all .12s', marginBottom: 2,
                  borderLeft: active ? `3px solid ${C.or}` : '3px solid transparent',
                }}
                  onMouseEnter={e => !active && (e.currentTarget.style.color = C.wh)}
                  onMouseLeave={e => !active && (e.currentTarget.style.color = C.g4)}
                >
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
                  <span>{item.label}</span>
                  {item.restricted && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: C.g7 }}>🔒</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Usuario */}
      <div style={{
        padding: '12px 16px', borderTop: `1px solid ${C.g8}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%', background: C.or,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: C.wh, flexShrink: 0,
        }}>
          {user.nombre?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.wh, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.nombre?.split(' ')[0]}
          </div>
          <div style={{ fontSize: 11, color: C.g5, textTransform: 'capitalize' }}>{user.rol}</div>
        </div>
        <button onClick={onLogout} style={{
          background: 'none', border: 'none', color: C.g5,
          cursor: 'pointer', fontSize: 16, padding: 4,
          borderRadius: 6, transition: 'color .1s',
        }}
          title="Cerrar sesión"
          onMouseEnter={e => (e.currentTarget.style.color = C.rd)}
          onMouseLeave={e => (e.currentTarget.style.color = C.g5)}
        >⏻</button>
      </div>
    </div>
  )
}

// ── App principal ──────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(() => {
    try { const s = localStorage.getItem('sl_erp_user'); return s ? JSON.parse(s) : null }
    catch { return null }
  })
  const [view, setView]     = useState('dashboard')
  const [nav, setNav]       = useState(null)   // { proyectoId, contratoId, pedidoId, actaId, remisionId, desde }
  const [navKey, setNavKey] = useState(0)      // fuerza a remontar la página al navegar
  const [toasts, setToasts] = useState([])
  const [dbData, setDbData] = useState({
    constructoras: [], proyectos: [], contratos: [],
    items_contrato: [], cotizaciones: [], adicionales: [],
    pedidos: [], despachos: [], actas_facturacion: [],
    actas_instalacion: [],
    // de la app de obras existente:
    obras: [], usuarios: [], elementos: [], liquidaciones: [],
  })
  const [loading, setLoading] = useState(true)

  const toast = (msg, t = 'info') => {
    const id = Date.now()
    setToasts(x => [...x, { id, msg, t }])
    setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 5000)
  }

  function login(u) {
    setUser(u)
    localStorage.setItem('sl_erp_user', JSON.stringify(u))
  }

  function logout() {
    setUser(null)
    localStorage.removeItem('sl_erp_user')
    setView('dashboard')
  }

  // Cargar datos al iniciar
  async function loadAll() {
    setLoading(true)
    try {
      const tables = [
        'constructoras', 'proyectos', 'contratos', 'items_contrato',
        'cotizaciones', 'adicionales', 'pedidos', 'items_pedido', 'proveedores',
        'remisiones', 'items_remision', 'items_control_despacho', 'lotes_produccion', 'items_lote', 'actas_facturacion',
        'items_acta_facturacion', 'actas_instalacion', 'items_acta_instalacion',
        'subitems_instalacion',
        // tablas existentes:
        'obras', 'usuarios', 'elementos', 'liquidaciones',
      ]
      const results = await Promise.all(
        tables.map(t => supabase.from(t).select('*').then(r => ({ t, data: r.data || [] })))
      )
      const newData = {}
      results.forEach(({ t, data }) => { newData[t] = data })
      setDbData(newData)
    } catch (e) {
      toast('Error cargando datos: ' + e.message, 'err')
    }
    setLoading(false)
  }

  useEffect(() => { if (user) loadAll() }, [user])

  if (!user) return <Login onLogin={login} />

  // Props compartidas a todas las páginas
  // ── Navegación entre módulos (ej: desde el dashboard del proyecto) ──
  const puedeIr = key =>
    MODULES.some(sec => sec.items.some(it => it.key === key && it.roles.includes(user.rol)))

  function irA(key, params = null) {
    if (!puedeIr(key)) { toast('No tienes acceso a ese módulo', 'err'); return }
    setNav(params)
    setView(key)
    setNavKey(k => k + 1)
  }

  // Clic en el menú lateral: entra al módulo limpio
  function irMenu(key) {
    setNav(null)
    setView(key)
    setNavKey(k => k + 1)
  }

  const shared = {
    user, dbData, setDbData, toast, reload: loadAll, loading,
    ROLES, nav, irA, puedeIr,
  }

  const pages = {
    dashboard:     <Dashboard    {...shared} />,
    comercial:     <Comercial    {...shared} />,
    contratos:     <Contratos    {...shared} />,
    proyectos:     <Proyectos    {...shared} />,
    constructoras: <Constructoras {...shared} />,
    pedidos:       <Pedidos      {...shared} />,
    produccion:    <Produccion   {...shared} />,
    despachos:     <Despachos    {...shared} />,
    instalacion:   <Instalacion  {...shared} />,
    adicionales:   <Adicionales  {...shared} />,
    facturacion:   <Facturacion  {...shared} />,
    config:        <Config       {...shared} />,
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Toast items={toasts} setItems={setToasts} />
      <Sidebar user={user} view={view} setView={irMenu} onLogout={logout} />

      {/* Área de contenido */}
      <main style={{
        flex: 1, overflow: 'auto', background: C.g0,
        display: 'flex', flexDirection: 'column',
      }}>
        {loading ? (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column', gap: 12,
          }}>
            <div style={{
              width: 48, height: 48, border: `3px solid ${C.g2}`,
              borderTopColor: C.or, borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <p style={{ color: C.g4, fontSize: 14 }}>Cargando datos…</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        ) : (
          <div key={navKey} style={{ padding: '24px 28px', flex: 1 }}>
            {pages[view] || <div style={{ color: C.g4 }}>Módulo no encontrado</div>}
          </div>
        )}
      </main>
    </div>
  )
}
