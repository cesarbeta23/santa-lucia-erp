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

// Igual que callClaude pero recibiendo la respuesta por pedacitos.
// Sirve para respuestas largas (cuadros de contrato), que si no se caen por tiempo.
export async function callClaudeStream(body, onTexto) {
  const r = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  })
  if (!r.ok || !r.body) throw new Error(`El servidor respondió ${r.status}`)

  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buffer = '', texto = '', motivo = null, errorApi = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += dec.decode(value, { stream: true })
    const lineas = buffer.split('\n')
    buffer = lineas.pop() || ''
    for (const linea of lineas) {
      if (!linea.startsWith('data:')) continue
      const crudo = linea.slice(5).trim()
      if (!crudo || crudo === '[DONE]') continue
      let ev
      try { ev = JSON.parse(crudo) } catch { continue }
      if (ev.type === 'content_block_delta' && ev.delta?.text) {
        texto += ev.delta.text
        if (onTexto) onTexto(texto)
      }
      if (ev.type === 'message_delta' && ev.delta?.stop_reason) motivo = ev.delta.stop_reason
      if (ev.type === 'error') errorApi = ev.error?.message || 'Error de la IA'
    }
  }
  if (errorApi) throw new Error(errorApi)
  return { texto, motivo }
}
