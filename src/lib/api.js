// URL del proxy según entorno
export const CLAUDE_API_URL = import.meta.env.DEV
  ? 'http://localhost:3001/api/claude'   // desarrollo local
  : '/api/claude'                         // producción Vercel

// URL de cualquier función del servidor (/api/xxx) según entorno
export const apiUrl = path => import.meta.env.DEV ? `http://localhost:3001${path}` : path

export async function callClaude(body) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}
