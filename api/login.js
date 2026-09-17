// Login seguro: valida correo + PIN en el servidor y entrega un "pase" (JWT) firmado.
// Las claves maestras viven SOLO en las variables de entorno de Vercel.
import crypto from 'crypto'

const SUPA_URL   = process.env.SUPABASE_URL || 'https://kboumpkcrdeuteiiodjp.supabase.co'
const HORAS_PASE = 12

const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

function firmarJWT(payload, secreto) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body   = b64url(JSON.stringify(payload))
  const firma  = b64url(crypto.createHmac('sha256', secreto).update(`${header}.${body}`).digest())
  return `${header}.${body}.${firma}`
}

const esperar = ms => new Promise(r => setTimeout(r, ms))

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Método no permitido' }); return }

  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const SECRETO = process.env.SUPABASE_JWT_SECRET
  if (!SERVICE || !SECRETO) { res.status(500).json({ error: 'Login no configurado en el servidor' }); return }

  // Se ingresa con la cédula; en la base el usuario es cedula@obra.com (igual que Gestión de Obras)
  let email = String(req.body?.email || '').trim().toLowerCase()
  if (email && !email.includes('@')) email = `${email.replace(/[\s.]/g, '')}@obra.com`
  const pin   = String(req.body?.pin || '').trim()
  if (!email || !pin) { res.status(400).json({ error: 'Ingresa cédula y PIN' }); return }

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/usuarios?select=*&email=eq.${encodeURIComponent(email)}`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })
    const filas = await r.json()
    const user  = Array.isArray(filas) ? filas.find(u => String(u.pin ?? '') === pin) : null

    if (!user) {
      await esperar(800)   // frena intentos de adivinar PINs
      res.status(401).json({ error: 'Cédula o PIN incorrecto' })
      return
    }

    if (!user.rol_erp) {
      res.status(403).json({ error: 'No tienes acceso a este sistema' })
      return
    }

    const ahora = Math.floor(Date.now() / 1000)
    const exp   = ahora + HORAS_PASE * 3600
    const token = firmarJWT({
      sub: String(user.id), role: 'authenticated', aud: 'authenticated',
      iat: ahora, exp, email: user.email, app: 'erp', app_rol: user.rol_erp,
    }, SECRETO)

    const { pin: _omitido, rol: rolObras, rol_erp, ...resto } = user
    const usuario = { ...resto, rol: rol_erp, rol_obras: rolObras }   // en el ERP manda rol_erp
    res.status(200).json({ user: usuario, token, exp })
  } catch (e) {
    res.status(500).json({ error: 'Error de conexión: ' + e.message })
  }
}
