import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
    const data = req.body
    const tmpIn  = join(tmpdir(), `informe_data_${Date.now()}.json`)
    const tmpOut = join(tmpdir(), `informe_${Date.now()}.xlsx`)

    writeFileSync(tmpIn, JSON.stringify(data))
    execSync(`python3 /var/task/generar_informe.py '${JSON.stringify(data).replace(/'/g, "\\'")}'  ${tmpOut}`, { timeout: 30000 })

    const file = readFileSync(tmpOut)
    unlinkSync(tmpIn)
    unlinkSync(tmpOut)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="informe_cobro.xlsx"`)
    res.status(200).send(file)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
