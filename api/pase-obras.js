// Pase para saltar del ERP a Gestión de Obras sin volver a ingresar.
// Recibe la sesión actual del ERP, la valida y entrega una sesión de Gestión
// solo si el usuario tiene rol allá (usuarios.rol).
import crypto from 'crypto'

const SUPA_URL   = process.env.SUPABASE_URL || 'https://kboumpkcrdeuteiiodjp.supabase.co'
const HORAS_PASE = 12

const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const deB64url = str => Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

function firmar(payload, secreto) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body   = b64url(JSON.stringify(payload))
  const firma  = b64url(crypto.createHmac('sha256', secreto).update(`${header}.${body}`).digest())
  return `${header}.${body}.${firma}`
}

function verificar(token, secreto) {
  const [h, b, f] = String(token || '').split('.')
  if (!h || !b || !f) return null
  const esperada = b64url(crypto.createHmac('sha256', secreto).update(`${h}.${b}`).digest())
  if (esperada.length !== f.length || !crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(f))) return null
  const payload = JSON.parse(deB64url(b))
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null
  return payload
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Método no permitido' }); return }

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const SECRETO = process.env.SUPABASE_JWT_SECRET
  if (!SERVICE || !SECRETO) { res.status(500).json({ error: 'Pase no configurado en el servidor' }); return }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const sesion = verificar(token, SECRETO)
  if (!sesion) { res.status(401).json({ error: 'Tu sesión venció, vuelve a ingresar' }); return }

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/usuarios?select=*&id=eq.${encodeURIComponent(sesion.sub)}`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })
    const filas = await r.json()
    const user = Array.isArray(filas) ? filas[0] : null
    if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return }
    const ROLES_OBRAS = ['superadmin', 'supervisor', 'auxiliar', 'instalador']
    if (!ROLES_OBRAS.includes(user.rol)) { res.status(403).json({ error: 'No tienes acceso a Gestión de Obras' }); return }

    const ahora = Math.floor(Date.now() / 1000)
    const exp   = ahora + HORAS_PASE * 3600
    const pase  = firmar({
      sub: String(user.id), role: 'authenticated', aud: 'authenticated',
      iat: ahora, exp, email: user.email, app: 'obras', app_rol: user.rol,
    }, SECRETO)

    const { pin: _p, rol_erp: _e, ...usuario } = user
    res.status(200).json({ token: pase, exp, user: usuario })
  } catch (e) {
    res.status(500).json({ error: 'Error de conexión: ' + e.message })
  }
}
