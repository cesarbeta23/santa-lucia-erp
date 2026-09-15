// Servidor proxy local para llamadas a Anthropic API (resuelve CORS)
// Correr con: node server.js
const http = require('http')
const https = require('https')

const PORT = 3001
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || ''

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }
  if (req.method !== 'POST' || req.url !== '/api/claude') {
    res.writeHead(404); res.end('Not found'); return
  }

  let body = ''
  req.on('data', chunk => body += chunk)
  req.on('end', () => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      }
    }

    const proxy = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      proxyRes.pipe(res)
    })

    proxy.on('error', e => {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }))
    })
    proxy.write(body)
    proxy.end()
  })
})

server.listen(PORT, () => {
  console.log(`✅ Proxy Santa Lucía corriendo en http://localhost:${PORT}`)
  console.log(`   Llama a POST http://localhost:${PORT}/api/claude`)
  if (!ANTHROPIC_KEY) console.warn('⚠️  ANTHROPIC_API_KEY no configurada')
})
