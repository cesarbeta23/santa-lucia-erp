import { useState, useEffect } from 'react'
import { C, Btn, Inp, Toast, fmt } from './components/UI.jsx'
import { supabase, setAccessToken } from './lib/supabase.js'
import { apiUrl } from './lib/api.js'

const SESION_KEY = 'sl_erp_session'
const GESTION_URL = 'https://gestion-obras-gilt.vercel.app'
const ROLES_GESTION = ['superadmin', 'supervisor', 'auxiliar', 'instalador']

// Abre Gestión de Obras con la sesión actual, sin volver a ingresar
async function irAGestion(toast) {
  const ventana = window.open('about:blank', '_blank')   // se abre de una para que no la bloquee el navegador
  try {
    const token = JSON.parse(localStorage.getItem(SESION_KEY) || 'null')?.token
    const r = await fetch(apiUrl('/api/pase-obras'), { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data.token) { ventana?.close(); toast(data.error || 'No se pudo abrir Gestión de Obras', 'err'); return }
    const sso = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
    const url = `${GESTION_URL}/#sso=${encodeURIComponent(sso)}`
    if (ventana) ventana.location.href = url; else window.location.href = url
  } catch { ventana?.close(); toast('Error de conexión', 'err') }
}

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

// ── Roles del ERP (columna usuarios.rol_erp) ───────────────
// La columna "rol" sigue siendo la de Gestión de Obras y no se toca.
const ROLES = {
  SA: 'superadmin',    // César — todo
  FA: 'facturacion',   // asistente de facturación — todo menos configuración
  SV: 'supervisor',    // supervisores — todo menos facturación y contratos
  CO: 'contratos',     // asistente de contratos — todo menos configuración
  PR: 'produccion',    // jefe y auxiliar de producción — producción y despachos; pedidos solo ver
  AL: 'almacen',       // almacén — pedidos y compras; producción y despachos solo ver
}
const TODOS_MENOS_FACT = ['superadmin', 'facturacion', 'contratos', 'supervisor']
const CON_FACT = ['superadmin', 'facturacion', 'contratos']   // también ven el módulo Contratos

// ── Módulos del sidebar ────────────────────────────────────
const MODULES = [
  {
    section: 'Principal',
    items: [
      { key: 'dashboard',    label: 'Dashboard',       icon: '◼', roles: TODOS_MENOS_FACT },
    ],
  },
  {
    section: 'Comercial',
    items: [
      { key: 'constructoras',label: 'Constructoras',   icon: '🏢', roles: TODOS_MENOS_FACT },
      { key: 'proyectos',    label: 'Proyectos',       icon: '🏗️', roles: TODOS_MENOS_FACT },
      { key: 'contratos',    label: 'Contratos',       icon: '📄', roles: CON_FACT },
    ],
  },
  {
    section: 'Operativo',
    items: [
      { key: 'pedidos',      label: 'Pedidos',         icon: '📦', roles: [...TODOS_MENOS_FACT, 'produccion', 'almacen'] },
      { key: 'produccion',   label: 'Producción',      icon: '🔨', roles: [...TODOS_MENOS_FACT, 'produccion', 'almacen'] },
      { key: 'despachos',    label: 'Despachos',       icon: '🚚', roles: [...TODOS_MENOS_FACT, 'produccion', 'almacen'] },
      { key: 'instalacion',  label: 'Instalación',     icon: '🔧', roles: TODOS_MENOS_FACT },
      { key: 'adicionales',  label: 'Adicionales',     icon: '➕', roles: TODOS_MENOS_FACT },
    ],
  },
  {
    section: 'Financiero',
    items: [
      { key: 'facturacion',  label: 'Facturación',     icon: '💰', roles: CON_FACT, restricted: true },
    ],
  },
  {
    section: 'Sistema',
    items: [
      { key: 'config',       label: 'Configuración',   icon: '⚙️', roles: ['superadmin'] },
    ],
  },
]

// Roles que NO ven valores de compra (precios de pedidos)
const SIN_VALORES_COMPRA = ['produccion']
// Roles que NO ven el valor de los contratos con la constructora
const SIN_VALOR_CONTRATO = ['produccion', 'almacen']

// Módulos que el rol puede VER pero no modificar
const SOLO_LECTURA = {
  produccion: ['pedidos'],
  almacen:    ['produccion', 'despachos'],
}

const modulosDe = rol => MODULES.flatMap(sec => sec.items).filter(it => it.roles.includes(rol)).map(it => it.key)

// ── Componente Login ───────────────────────────────────────
function Login({ onLogin }) {
  const [form, setForm] = useState({ email: '', pin: '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!form.email || !form.pin) { setErr('Ingresa cédula y PIN'); return }
    setLoading(true)
    try {
      const r = await fetch(apiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, pin: form.pin }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.token) { setErr(data.error || 'Cédula o PIN incorrecto'); return }
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
      justifyContent: 'center', fontFamily: 'inherit',
      background: `radial-gradient(1200px 600px at 50% -10%, ${C.g7} 0%, ${C.g9} 60%)`,
    }}>
      <div style={{
        background: C.wh, borderRadius: 20, padding: '2.5rem',
        width: 380, boxShadow: '0 24px 64px rgba(0,0,0,.4)',
        border: `1px solid ${C.g8}`,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <img src="/logo.jpg" alt="Santa Lucía Muebles y Pisos" style={{ height: 96, margin: '0 auto 14px', display: 'block' }} />
          <div style={{ fontSize: 13, color: C.g5 }}>Sistema de información</div>
        </div>

        <Inp
          label="Cédula"
          type="text"
          placeholder="Número de cédula o usuario"
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
function Sidebar({ user, view, setView, onLogout, onIrGestion }) {
  const visibleModules = MODULES.map(sec => ({
    ...sec,
    items: sec.items.filter(it => it.roles.includes(user.rol)),
  })).filter(sec => sec.items.length > 0)

  return (
    <div style={{
      width: 220, background: `linear-gradient(180deg, ${C.g8} 0%, ${C.g9} 100%)`, display: 'flex',
      flexDirection: 'column', height: '100vh',
      borderRight: `1px solid ${C.g8}`, flexShrink: 0,
    }}>
      {/* Logo sidebar */}
      <div style={{
        padding: '16px 16px 14px', borderBottom: `1px solid ${C.g8}`,
        display: 'flex', alignItems: 'center', gap: 11,
      }}>
        <div style={{
          width: 38, height: 38, background: C.wh, borderRadius: 10, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: `0 0 0 1px ${C.g7}`,
        }}>
          <img src="/logo.jpg" alt="Santa Lucía" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.wh, letterSpacing: '-.01em' }}>Santa Lucía</div>
          <div style={{ fontSize: 11, color: C.g4 }}>Muebles y pisos</div>
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
                  background: active ? 'rgba(249,115,22,.14)' : 'transparent',
                  border: 'none', color: active ? C.wh : C.g4,
                  fontSize: 13, fontWeight: active ? 650 : 400,
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

      {/* Salto a Gestión de Obras */}
      {ROLES_GESTION.includes(user.rol_obras) && onIrGestion && (
        <div style={{ padding: '0 10px 10px' }}>
          <button onClick={onIrGestion} title="Abrir Gestión de Obras sin volver a ingresar" style={{
            width: '100%', padding: '9px 10px', borderRadius: 8, border: `1px solid ${C.or}`,
            background: 'transparent', color: C.or, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>↗ Gestión de Obras</button>
        </div>
      )}

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
    try {
      // Llegó desde Gestión de Obras con un pase: se guarda como sesión y se limpia la URL
      const m = window.location.hash.match(/^#sso=(.+)$/)
      if (m) {
        const data = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))))
        if (data?.token && data?.exp && data.exp * 1000 > Date.now()) {
          localStorage.setItem(SESION_KEY, JSON.stringify({ user: data.user, token: data.token, exp: data.exp }))
        }
        window.history.replaceState(null, '', window.location.pathname)
      }
    } catch { /* pase dañado: se sigue con el login normal */ }
    try {
      localStorage.removeItem('sl_erp_user')   // sesión vieja (sin pase)
      const s = JSON.parse(localStorage.getItem(SESION_KEY) || 'null')
      if (!s?.token || !s?.exp || s.exp * 1000 < Date.now()) { localStorage.removeItem(SESION_KEY); return null }
      setAccessToken(s.token)
      return { ...s.user, _exp: s.exp }
    } catch { return null }
  })
  const [view, setView]     = useState('dashboard')
  const esMovil = () => typeof window !== 'undefined' && window.innerWidth < 900
  const [menuAbierto, setMenuAbierto] = useState(() => !esMovil())
  useEffect(() => {
    const alCambiar = () => setMenuAbierto(!esMovil())
    window.addEventListener('resize', alCambiar)
    return () => window.removeEventListener('resize', alCambiar)
  }, [])
  const [nav, setNav]       = useState(null)   // { proyectoId, contratoId, pedidoId, actaId, remisionId, desde }
  const [navKey, setNavKey] = useState(0)      // fuerza a remontar la página al navegar
  const [toasts, setToasts] = useState([])
  const [dbData, setDbData] = useState({
    constructoras: [], proyectos: [], contratos: [],
    items_contrato: [], cotizaciones: [], adicionales: [],
    pedidos: [], despachos: [], actas_facturacion: [],
    actas_instalacion: [], mapa_items_instalacion: [],
    // de la app de obras existente:
    obras: [], usuarios: [], elementos: [], liquidaciones: [],
  })
  const [loading, setLoading] = useState(true)

  const toast = (msg, t = 'info') => {
    const id = Date.now()
    setToasts(x => [...x, { id, msg, t }])
    setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 5000)
  }

  function login({ user: u, token, exp }) {
    setAccessToken(token)
    localStorage.setItem(SESION_KEY, JSON.stringify({ user: u, token, exp }))
    setUser({ ...u, _exp: exp })
  }

  function logout() {
    setAccessToken(null)
    localStorage.removeItem(SESION_KEY)
    setUser(null)
    setView('dashboard')
    setNav(null)
  }

  // Si el rol no tiene la vista actual (ej. producción no ve Dashboard), ir al primer módulo permitido
  useEffect(() => {
    if (!user) return
    const perm = modulosDe(user.rol)
    if (!perm.includes(view)) setView(perm[0] || 'dashboard')
  }, [user?.rol])

  // Cerrar sesión cuando el pase vence
  useEffect(() => {
    if (!user?._exp) return
    const ms = user._exp * 1000 - Date.now()
    if (ms <= 0) { logout(); return }
    const t = setTimeout(() => { logout(); toast('Tu sesión venció, vuelve a ingresar', 'info') }, Math.min(ms, 2147483647))
    return () => clearTimeout(t)
  }, [user?._exp])

  // Cargar datos al iniciar
  async function loadAll() {
    setLoading(true)
    try {
      const tables = [
        'constructoras', 'proyectos', 'contratos', 'items_contrato',
        'cotizaciones', 'adicionales', 'pedidos', 'items_pedido', 'proveedores', 'ingresos_material',
        'remisiones', 'items_remision', 'items_control_despacho', 'lotes_produccion', 'items_lote', 'actas_facturacion',
        'items_acta_facturacion', 'actas_instalacion', 'items_acta_instalacion',
        'subitems_instalacion', 'mapa_items_instalacion', 'entregas_instalacion', 'cantidades_torre',
        // de Gestión de Obras (solo lectura, para el avance de instalación):
        'obras', 'elementos', 'liquidaciones', 'usuarios',
      ]
      const results = await Promise.all(
        // De usuarios solo se traen los datos básicos: nunca el PIN
        tables.map(t => supabase.from(t).select(t === 'usuarios' ? 'id,nombre,email,rol,rol_erp,oficio,cedula' : '*')
          .then(r => ({ t, data: r.data || [], error: r.error })))
      )
      if (results.some(r => r.error && /jwt|token/i.test(r.error.message || ''))) {
        logout(); toast('Tu sesión venció, vuelve a ingresar', 'info'); return
      }
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
  const permitidos = modulosDe(user.rol)
  const puedeIr = key => permitidos.includes(key)
  // ¿Puede crear, editar o eliminar en ese módulo?
  const puedeEditar = key => puedeIr(key) && !(SOLO_LECTURA[user.rol] || []).includes(key)

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
    if (esMovil()) setMenuAbierto(false)
  }

  const shared = {
    user, dbData, setDbData, toast, reload: loadAll, loading,
    ROLES, nav, irA, puedeIr, puedeEditar,
    verValoresCompra:  !SIN_VALORES_COMPRA.includes(user.rol),
    verValorContrato:  !SIN_VALOR_CONTRATO.includes(user.rol),
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
      {menuAbierto && (
        <>
          {/* fondo oscuro para cerrar el menú en el celular */}
          {esMovil() && <div onClick={() => setMenuAbierto(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 40 }} />}
          <div style={esMovil() ? { position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50 } : {}}>
            <Sidebar user={user} view={view} setView={irMenu} onLogout={logout} onIrGestion={() => irAGestion(toast)} />
          </div>
        </>
      )}

      {/* Área de contenido */}
      <main style={{
        flex: 1, overflow: 'auto', background: C.bg,
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
          <div key={navKey} style={{ padding: esMovil() ? '12px 12px' : '24px 28px', flex: 1, minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }}>
            {/* botón de menú (en celular siempre; en PC para ganar espacio) */}
            <button onClick={() => setMenuAbierto(a => !a)} title="Menú"
              style={{ position: 'sticky', top: 0, zIndex: 30, marginBottom: 10, background: C.wh, color: C.bk, border: `1px solid ${C.g3}`, borderRadius: 9, padding: '6px 12px', fontSize: 16, cursor: 'pointer', boxShadow: '0 1px 2px rgba(35,39,46,.06)' }}>
              {menuAbierto && !esMovil() ? '⟨' : '☰'}
            </button>
            {puedeIr(view) ? pages[view] : <div style={{ color: C.g4 }}>No tienes acceso a este módulo</div>}
          </div>
        )}
      </main>
    </div>
  )
}
