import * as XLSX from 'xlsx'

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
    const { proyecto, constructora, contrato, tipo, fecha, items } = req.body

    const wb = XLSX.utils.book_new()

    // ── Datos del encabezado ──────────────────────────────────
    const encabezado = [
      ['SANTA LUCÍA MUEBLES Y PISOS S.A.S.'],
      ['INFORME DE COBRO — PENDIENTE POR FACTURAR'],
      [''],
      ['CONSTRUCTORA:', constructora || '—'],
      ['PROYECTO / OBRA:', proyecto || '—'],
      ['CONTRATO:', `#${contrato || '—'} (${tipo || '—'})`],
      ['FECHA DE EMISIÓN:', fecha || new Date().toLocaleDateString('es-CO')],
      ['NIT SANTA LUCÍA:', '900.602.879-5'],
      [''],
    ]

    // ── Encabezado de tabla ───────────────────────────────────
    const tableHeader = [
      ['REF', 'DESCRIPCIÓN', 'UM', 'DESPACHADO', 'FACTURADO', 'X FACTURAR', 'VR. UNITARIO', 'TOTAL A COBRAR']
    ]

    // ── Filas de datos ────────────────────────────────────────
    const filas = items.map(it => [
      it.ref,
      it.descripcion,
      it.unidad,
      Number(it.despachado),
      Number(it.facturado),
      Number(it.xFact),
      Number(it.vrUnit),
      Number(it.totalFact),
    ])

    // ── Totales ───────────────────────────────────────────────
    const totalXFact = items.reduce((s, i) => s + Number(i.xFact), 0)
    const totalCobro = items.reduce((s, i) => s + Number(i.totalFact), 0)

    const totales = [
      ['', '', '', '', '', totalXFact, '', totalCobro],
      [''],
      ['NOTA: Los valores corresponden al suministro sin IVA. El IVA (19%) se discriminará en la factura.'],
      ['Santa Lucía Muebles y Pisos S.A.S. · NIT 900.602.879-5 · Tel: 311.341.04.58 · cesarbeta@gmail.com'],
    ]

    const allData = [...encabezado, ...tableHeader, ...filas, ...totales]
    const ws = XLSX.utils.aoa_to_sheet(allData)

    // ── Anchos de columna ─────────────────────────────────────
    ws['!cols'] = [
      { wch: 12 }, { wch: 48 }, { wch: 8 },
      { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 16 }, { wch: 18 },
    ]

    // ── Estilos ───────────────────────────────────────────────
    const headerFill  = { type: 'pattern', pattern: 'solid', fgColor: { rgb: '1F3A5F' } }
    const headerFont  = { name: 'Arial', bold: true, sz: 14, color: { rgb: 'FFFFFF' } }
    const subFill     = { type: 'pattern', pattern: 'solid', fgColor: { rgb: '1E293B' } }
    const subFont     = { name: 'Arial', bold: true, sz: 10, color: { rgb: '93C5FD' } }
    const tblHdrFill  = { type: 'pattern', pattern: 'solid', fgColor: { rgb: '1E3A5F' } }
    const tblHdrFont  = { name: 'Arial', bold: true, sz: 9, color: { rgb: 'FFFFFF' } }
    const refFont     = { name: 'Arial', bold: true, sz: 9, color: { rgb: '1D4ED8' } }
    const normFont    = { name: 'Arial', sz: 9 }
    const grayFont    = { name: 'Arial', sz: 9, color: { rgb: '636366' } }
    const totalFill   = { type: 'pattern', pattern: 'solid', fgColor: { rgb: '1E3A5F' } }
    const totalFont   = { name: 'Arial', bold: true, sz: 11, color: { rgb: 'FFFFFF' } }
    const grandFill   = { type: 'pattern', pattern: 'solid', fgColor: { rgb: '1D4ED8' } }
    const grandFont   = { name: 'Arial', bold: true, sz: 13, color: { rgb: 'FFFFFF' } }
    const moneyFmt    = '$#,##0'
    const numFmt      = '#,##0'
    const centerAlign = { horizontal: 'center', vertical: 'center' }
    const rightAlign  = { horizontal: 'right',  vertical: 'center' }
    const leftAlign   = { horizontal: 'left',   vertical: 'center' }
    const border      = {
      top:    { style: 'thin', color: { rgb: 'D1D1D6' } },
      bottom: { style: 'thin', color: { rgb: 'D1D1D6' } },
      left:   { style: 'thin', color: { rgb: 'D1D1D6' } },
      right:  { style: 'thin', color: { rgb: 'D1D1D6' } },
    }

    function styleCell(addr, font, fill, alignment, numFmt_, border_) {
      if (!ws[addr]) ws[addr] = { t: 'z', v: '' }
      ws[addr].s = {}
      if (font)      ws[addr].s.font      = font
      if (fill)      ws[addr].s.fill      = fill
      if (alignment) ws[addr].s.alignment = alignment
      if (numFmt_)   ws[addr].s.numFmt    = numFmt_
      if (border_)   ws[addr].s.border    = border_
    }

    // Fila 1: título principal (A1)
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },  // título
      { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },  // subtítulo
      { s: { r: 8, c: 0 }, e: { r: 8, c: 7 } },  // separador
    ]

    styleCell('A1', headerFont, headerFill, leftAlign)
    styleCell('A2', subFont, subFill, leftAlign)

    // Info
    const infoRows = [3,4,5,6,7]
    infoRows.forEach(r => {
      styleCell(`A${r}`, { name:'Arial', bold:true, sz:9, color:{rgb:'636366'} }, { type:'pattern',pattern:'solid',fgColor:{rgb:'F8FAFC'} }, leftAlign)
      styleCell(`B${r}`, { name:'Arial', bold:true, sz:10 }, { type:'pattern',pattern:'solid',fgColor:{rgb:'F8FAFC'} }, leftAlign)
    })

    // Header tabla (fila 10 = índice 9)
    const tblRow = 9
    'ABCDEFGH'.split('').forEach(col => {
      styleCell(`${col}${tblRow + 1}`, tblHdrFont, tblHdrFill, centerAlign, null, border)
    })

    // Filas de datos
    const dataStart = tblRow + 2
    items.forEach((_, i) => {
      const row = dataStart + i
      const bgFill = i % 2 === 0
        ? { type:'pattern', pattern:'solid', fgColor:{rgb:'FFFFFF'} }
        : { type:'pattern', pattern:'solid', fgColor:{rgb:'F1F5F9'} }
      styleCell(`A${row}`, refFont, bgFill, centerAlign, null, border)
      styleCell(`B${row}`, normFont, bgFill, leftAlign, null, border)
      styleCell(`C${row}`, grayFont, bgFill, centerAlign, null, border)
      styleCell(`D${row}`, normFont, bgFill, rightAlign, numFmt, border)
      styleCell(`E${row}`, normFont, bgFill, rightAlign, numFmt, border)
      styleCell(`F${row}`, { name:'Arial', bold:true, sz:9 }, bgFill, rightAlign, numFmt, border)
      styleCell(`G${row}`, grayFont, bgFill, rightAlign, moneyFmt, border)
      styleCell(`H${row}`, { name:'Arial', bold:true, sz:9, color:{rgb:'1D4ED8'} }, bgFill, rightAlign, moneyFmt, border)
    })

    // Fila de totales
    const totRow = dataStart + items.length
    ;['A','B','C','D','E'].forEach(c => styleCell(`${c}${totRow}`, totalFont, totalFill, rightAlign, null, border))
    styleCell(`F${totRow}`, totalFont, totalFill, rightAlign, numFmt, border)
    styleCell(`G${totRow}`, totalFont, totalFill, rightAlign, null, border)
    styleCell(`H${totRow}`, grandFont, grandFill, rightAlign, moneyFmt, border)

    // Merge fila total A-E
    ws['!merges'].push({ s: { r: totRow-1, c: 0 }, e: { r: totRow-1, c: 4 } })
    if (ws[`A${totRow}`]) ws[`A${totRow}`].v = 'TOTAL PENDIENTE POR FACTURAR'

    // Nota al pie
    const notaRow = totRow + 2
    ws['!merges'].push({ s: { r: notaRow-1, c: 0 }, e: { r: notaRow-1, c: 7 } })
    styleCell(`A${notaRow}`, { name:'Arial', sz:8, italic:true, color:{rgb:'636366'} }, { type:'pattern',pattern:'solid',fgColor:{rgb:'F1F5F9'} }, leftAlign)

    // Freeze header
    ws['!freeze'] = { xSplit: 0, ySplit: dataStart - 1 }

    XLSX.utils.book_append_sheet(wb, ws, 'Informe de Cobro')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="Cobro_${proyecto}_${contrato}.xlsx"`)
    res.status(200).send(Buffer.from(buf))

  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
