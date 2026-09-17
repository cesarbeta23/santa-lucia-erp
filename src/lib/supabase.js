import { createClient } from '@supabase/supabase-js'

// Supabase existente de la app de gestión de obras
const SUPA_URL = 'https://kboumpkcrdeuteiiodjp.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtib3VtcGtjcmRldXRlaWlvZGpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2ODA2MTQsImV4cCI6MjA5NDI1NjYxNH0.gTjqSnxI8F7ozcLSWB2rCDexP7ubgX1fwG2uOM3L0rI'

// Pase de sesión entregado por /api/login. Sin pase, la base no entrega datos (cuando RLS esté activo).
let _pase = null
export function setAccessToken(token) { _pase = token || null }

export const supabase = createClient(SUPA_URL, SUPA_KEY, {
  accessToken: async () => _pase,
})

// ── Helpers genéricos ──────────────────────────────────────
export const db = {
  get: async (table, query = '') =>
    supabase.from(table).select(query || '*'),

  insert: async (table, data) =>
    supabase.from(table).insert(data).select(),

  update: async (table, id, data) =>
    supabase.from(table).update(data).eq('id', id).select(),

  upsert: async (table, data) =>
    supabase.from(table).upsert(data).select(),

  delete: async (table, id) =>
    supabase.from(table).delete().eq('id', id),
}

export const fmt = n =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n || 0)

export const fmtDate = d =>
  d ? new Date(d).toLocaleDateString('es-CO') : '—'
