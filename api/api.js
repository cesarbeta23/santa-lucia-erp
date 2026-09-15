// URL del proxy según entorno
export const CLAUDE_API_URL = import.meta.env.DEV
  ? 'http://localhost:3001/api/claude'   // desarrollo local
  : '/api/claude'                         // producción Vercel

export async function callClaude(body) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}
