import { useEffect } from 'react'

// ── Colores ────────────────────────────────────────────────
export const C = {
  // Naranja de la marca
  or: '#F97316', orD: '#C2410C', orL: '#FFF4EA', orM: '#FCC89B',
  // Grafito en vez de negro puro, con una escala de grises más neutra
  bk: '#23272E', g9: '#1B1F25', g8: '#2B313A', g7: '#3A414B',
  g5: '#616B78', g4: '#98A1AE', g3: '#C6CCD5', g2: '#E1E5EA',
  g1: '#F1F3F6', g0: '#F6F7F9', wh: '#FFFFFF',
  // Fondo de la aplicación: gris claro para que las tarjetas y botones resalten
  bg: '#E8ECF2',
  gn: '#22C55E', gnL: '#DCFCE7', gnD: '#15803D',
  rd: '#EF4444', rdL: '#FEE2E2',
  am: '#F59E0B', amL: '#FEF3C7',
  bl: '#3B82F6', blL: '#EFF6FF',
}

// ── Estilos base ───────────────────────────────────────────
export const card = {
  background: C.wh, border: `1px solid #C9D1DB`,
  borderRadius: 14, padding: '1rem 1.25rem',
  boxShadow: '0 1px 2px rgba(35,39,46,.04), 0 6px 16px -12px rgba(35,39,46,.18)',
}

export const iSt = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 12px', border: `1px solid #C2CAD5`,
  borderRadius: 8, fontSize: 14, fontFamily: 'inherit',
  color: C.bk, background: C.wh,
}

// Cada variante lleva el borde del color de la acción
const bV = {
  primary: { background: C.or, border: `1px solid ${C.orD}`, color: C.wh, boxShadow: '0 1px 2px rgba(194,65,12,.25)' },
  default: { background: C.wh, border: `1px solid #A9B3C0`, color: C.bk, boxShadow: '0 1px 2px rgba(35,39,46,.08)' },
  danger:  { background: C.rdL, border: '1px solid #F5A8A8', color: '#B91C1C' },
  success: { background: C.gnL, border: '1px solid #8FE0AE', color: C.gnD },
  amber:   { background: C.amL, border: '1px solid #F2CE73', color: '#B45309' },
  ghost:   { background: 'transparent', border: `1px solid ${C.g7}`, color: C.g3 },
}

// ── Botón ──────────────────────────────────────────────────
export function Btn({ children, onClick, variant = 'default', disabled, size = 'md', style: s = {} }) {
  const v = bV[variant] || bV.default
  const pad = size === 'sm' ? '5px 12px' : size === 'lg' ? '12px 24px' : '8px 16px'
  const fs  = size === 'sm' ? 12 : size === 'lg' ? 15 : 14
  return (
    <button onClick={onClick} disabled={disabled} className="sl-btn" style={{
      ...v, borderRadius: 9, padding: pad, fontSize: fs,
      fontWeight: 600, letterSpacing: '-.01em', opacity: disabled ? 0.45 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: 'inherit', ...s,
    }}>
      {children}
    </button>
  )
}

// ── Input con label ────────────────────────────────────────
export function Inp({ label, hint, ...p }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, color: C.g5, display: 'block', marginBottom: 5, fontWeight: 500 }}>{label}</label>}
      <input style={iSt} {...p} />
      {hint && <span style={{ fontSize: 11, color: C.g4, marginTop: 4, display: 'block' }}>{hint}</span>}
    </div>
  )
}

// ── Select con label ───────────────────────────────────────
export function Sel({ label, children, hint, ...p }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, color: C.g5, display: 'block', marginBottom: 5, fontWeight: 500 }}>{label}</label>}
      <select style={{ ...iSt, background: C.wh }} {...p}>{children}</select>
      {hint && <span style={{ fontSize: 11, color: C.g4, marginTop: 4, display: 'block' }}>{hint}</span>}
    </div>
  )
}

// ── Textarea con label ─────────────────────────────────────
export function Txt({ label, ...p }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, color: C.g5, display: 'block', marginBottom: 5, fontWeight: 500 }}>{label}</label>}
      <textarea style={{ ...iSt, minHeight: 80, resize: 'vertical' }} {...p} />
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────
export function Modal({ title, onClose, children, wide, fullscreen }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const esc = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', esc) }
  }, [onClose])

  const maxW = fullscreen ? '96vw' : wide ? 760 : 540

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
      zIndex: 9999, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '1rem',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: C.wh, borderRadius: 16, border: `1px solid ${C.g2}`,
        maxWidth: maxW, width: '100%', maxHeight: '90vh',
        overflowY: 'auto', padding: '1.5rem',
        boxShadow: '0 24px 64px rgba(0,0,0,.2)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: C.g4, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Badge ──────────────────────────────────────────────────
const bdgMap = {
  green:  { bg: '#DCFCE7', c: '#15803D', b: '#BBF7D0' },
  orange: { bg: '#FFF7ED', c: '#EA6A0A', b: '#FED7AA' },
  amber:  { bg: '#FEF3C7', c: '#B45309', b: '#FDE68A' },
  red:    { bg: '#FEE2E2', c: '#EF4444', b: '#FECACA' },
  blue:   { bg: '#EFF6FF', c: '#2563EB', b: '#BFDBFE' },
  gray:   { bg: '#F2F2F7', c: '#636366', b: '#D1D1D6' },
}

export function Badge({ children, color = 'gray' }) {
  const v = bdgMap[color] || bdgMap.gray
  return (
    <span style={{
      background: v.bg, color: v.c, border: `1px solid ${v.b}`,
      borderRadius: 20, padding: '3px 10px', fontSize: 11,
      fontWeight: 500, display: 'inline-block', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

// ── Toast ──────────────────────────────────────────────────
export function Toast({ items, setItems }) {
  if (!items.length) return null
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
      {items.map(n => (
        <div key={n.id} style={{
          background: n.t === 'ok' ? C.gnL : n.t === 'err' ? C.rdL : C.orL,
          border: `1px solid ${n.t === 'ok' ? '#BBF7D0' : n.t === 'err' ? '#FECACA' : C.orM}`,
          borderRadius: 10, padding: '12px 16px',
          display: 'flex', gap: 10, boxShadow: '0 2px 8px rgba(0,0,0,.1)',
        }}>
          <span style={{ color: n.t === 'ok' ? C.gnD : n.t === 'err' ? C.rd : C.orD, fontSize: 16 }}>
            {n.t === 'ok' ? '✓' : n.t === 'err' ? '✕' : '🔔'}
          </span>
          <div style={{ flex: 1, fontSize: 13, color: n.t === 'ok' ? C.gnD : n.t === 'err' ? C.rd : C.orD }}>{n.msg}</div>
          <button onClick={() => setItems(x => x.filter(i => i.id !== n.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: C.g4 }}>×</button>
        </div>
      ))}
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────
export function Empty({ icon = '📋', title, desc, action }) {
  return (
    <div style={{
      textAlign: 'center', padding: '4rem 2rem',
      background: C.wh, borderRadius: 12,
      border: `1px solid ${C.g2}`, color: C.g4,
    }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: 15, color: C.g5, marginBottom: 6 }}>{title}</div>
      {desc && <p style={{ fontSize: 13, marginBottom: 16, maxWidth: 320, margin: '0 auto 16px' }}>{desc}</p>}
      {action}
    </div>
  )
}

// ── Stat card ──────────────────────────────────────────────
export function Stat({ label, value, sub, color = C.bk }) {
  return (
    <div style={{ background: C.wh, borderRadius: 10, padding: '14px 18px', border: `1px solid ${C.g2}` }}>
      <div style={{ fontSize: 11, color: C.g4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.g4, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ── Section header ─────────────────────────────────────────
export function SectionHeader({ title, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{title}</h2>
      <div style={{ display: 'flex', gap: 8 }}>{children}</div>
    </div>
  )
}

// ── Tabla simple ───────────────────────────────────────────
export function Tabla({ cols, rows, onRow }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.g0 }}>
            {cols.map((c, i) => (
              <th key={i} style={{
                padding: '10px 14px', textAlign: c.align || 'left',
                fontWeight: 600, color: C.g5, fontSize: 11,
                textTransform: 'uppercase', letterSpacing: '.06em',
                borderBottom: `2px solid ${C.g2}`,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} onClick={() => onRow?.(row)} style={{
              borderBottom: `1px solid ${C.g1}`,
              cursor: onRow ? 'pointer' : 'default',
              transition: 'background .1s',
            }}
              onMouseEnter={e => onRow && (e.currentTarget.style.background = C.g0)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              {cols.map((c, j) => (
                <td key={j} style={{ padding: '10px 14px', textAlign: c.align || 'left', ...c.tdStyle }}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Barra de progreso ──────────────────────────────────────
export function Progress({ value, color }) {
  const pct = Math.min(100, Math.max(0, value || 0))
  const bg = color || (pct === 100 ? C.gn : pct > 75 ? C.am : C.or)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: C.g4 }}>{Math.round(pct)}%</span>
      </div>
      <div style={{ height: 6, background: C.g1, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: bg, borderRadius: 10, transition: 'width .4s' }} />
      </div>
    </div>
  )
}

// ── Formato moneda ─────────────────────────────────────────
export const fmt = n =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0)

export const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-CO') : '—'

// ── Orden alfabético ───────────────────────────────────────
// No distingue mayúsculas ni tildes, y lee los números como números:
// así Torre 2 va antes que Torre 10, y "Ávila" queda junto a "Avila".
export const cmpTxt = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'es', { numeric: true, sensitivity: 'base' })
export const porNombre = (a, b) => cmpTxt(a?.nombre, b?.nombre)
export const ordNom = xs => [...(xs || [])].sort(porNombre)

// ── Datos de la empresa (módulo Configuración) ─────────────
// Una sola fila en la tabla `configuracion`. Si todavía no existe, se devuelven
// los valores de siempre para que remisiones e informes no salgan en blanco.
// A propósito NO trae teléfono ni correo: si la configuración no cargara, es
// preferible que el informe salga sin contacto a que salga con uno equivocado.
const EMPRESA_DEF = {
  empresa: 'Santa Lucía Muebles y Pisos S.A.S.', nit: '900.602.879-5',
}
export const empresaDe = dbData => ({ ...EMPRESA_DEF, ...((dbData?.configuracion || [])[0] || {}) })
// Pie de página: "Razón social · NIT 000 · Tel: 000 · correo"
export const pieEmpresa = e => [e.empresa, e.nit && `NIT ${e.nit}`, e.telefono && `Tel: ${e.telefono}`, e.email]
  .filter(Boolean).join(' · ')

// Una tasa del módulo Configuración (iva_pct, retenido_pct, utilidad_pct).
// Si la tabla aún no existe, devuelve el valor que estaba quemado antes.
export const tasaDe = (dbData, k, porDefecto) => {
  const v = Number(((dbData?.configuracion || [])[0] || {})[k])
  return Number.isFinite(v) ? v : porDefecto
}

// ── Hook toast ─────────────────────────────────────────────
export function useToast() {
  const [toasts, setToasts] = window.__toastState || [[], () => {}]
  return { toasts, setToasts }
}
