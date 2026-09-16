"""
Script para generar el informe de cobro en Excel.
Se ejecuta localmente: python generar_informe.py <json_data>
"""
import sys, json, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, numbers
from openpyxl.utils import get_column_letter
from openpyxl.drawing.image import Image as XLImage

def generar_informe(data: dict, output_path: str):
    wb = Workbook()
    ws = wb.active
    ws.title = "Informe de Cobro"

    # Colores
    NEGRO    = "0D0D0D"
    NARANJA  = "F97316"
    NAR_L    = "FFF7ED"
    NAR_M    = "FED7AA"
    GRIS1    = "F2F2F7"
    GRIS2    = "D1D1D6"
    VERDE    = "15803D"
    VER_L    = "DCFCE7"
    BLANCO   = "FFFFFF"
    GRIS_TX  = "636366"

    thin = Side(style='thin', color=GRIS2)
    brd  = Border(left=thin, right=thin, top=thin, bottom=thin)
    brd_nar = Border(left=Side(style='medium', color='1E3A5F'),
                     right=Side(style='thin', color=GRIS2),
                     top=Side(style='thin', color=GRIS2),
                     bottom=Side(style='thin', color=GRIS2))

    def cell(row, col, value='', bold=False, size=10, color=NEGRO, bg=None,
             align='left', fmt=None, border=None, italic=False):
        c = ws.cell(row=row, column=col, value=value)
        c.font = Font(name='Arial', bold=bold, size=size, color=color, italic=italic)
        if bg: c.fill = PatternFill('solid', start_color=bg)
        c.alignment = Alignment(horizontal=align, vertical='center', wrap_text=True)
        if fmt: c.number_format = fmt
        if border: c.border = border
        return c

    # Anchos de columna
    ws.column_dimensions['A'].width = 10
    ws.column_dimensions['B'].width = 44
    ws.column_dimensions['C'].width = 7
    ws.column_dimensions['D'].width = 12
    ws.column_dimensions['E'].width = 12
    ws.column_dimensions['F'].width = 12
    ws.column_dimensions['G'].width = 16
    ws.column_dimensions['H'].width = 18

    # ── CABECERA ──────────────────────────────────────────────
    # Fila 1: banda naranja con nombre empresa
    ws.merge_cells('A1:H1')
    ws.row_dimensions[1].height = 36
    c1 = ws['A1']
    c1.value = 'SANTA LUCÍA MUEBLES Y PISOS S.A.S.'
    c1.font  = Font(name='Arial', bold=True, size=16, color=BLANCO)
    c1.fill  = PatternFill('solid', start_color='1F3A5F')
    c1.alignment = Alignment(horizontal='left', vertical='center', indent=2)

    # Fila 2: subtítulo
    ws.merge_cells('A2:H2')
    ws.row_dimensions[2].height = 20
    c2 = ws['A2']
    c2.value = 'INFORME DE COBRO — PENDIENTE POR FACTURAR'
    c2.font  = Font(name='Arial', bold=True, size=11, color='93C5FD')
    c2.fill  = PatternFill('solid', start_color='1E293B')
    c2.alignment = Alignment(horizontal='left', vertical='center', indent=2)

    # Fila 3: separador
    ws.row_dimensions[3].height = 6
    for col in range(1, 9):
        ws.cell(row=3, column=col).fill = PatternFill('solid', start_color='BFDBFE')

    # Filas 4-8: info del proyecto
    ws.row_dimensions[4].height = 18
    ws.row_dimensions[5].height = 18
    ws.row_dimensions[6].height = 18
    ws.row_dimensions[7].height = 18
    ws.row_dimensions[8].height = 18

    info = [
        ('CONSTRUCTORA', data.get('constructora', '—')),
        ('PROYECTO / OBRA', data.get('proyecto', '—')),
        ('CONTRATO', f"#{data.get('contrato','—')} ({data.get('tipo','—')})"),
        ('FECHA DE EMISIÓN', data.get('fecha', datetime.date.today().strftime('%d/%m/%Y'))),
        ('NIT SANTA LUCÍA', '900.602.879-5'),
    ]

    ws.merge_cells('A4:B8')
    logo_cell = ws['A4']
    logo_cell.fill = PatternFill('solid', start_color=GRIS1)

    for i, (label, val) in enumerate(info):
        row = 4 + i
        ws.merge_cells(f'C{row}:D{row}')
        cell(row, 3, label, bold=True, size=9, color=GRIS_TX)
        ws.merge_cells(f'E{row}:H{row}')
        cell(row, 5, val, bold=True, size=10, color=NEGRO)

    # Fila 9: separador
    ws.row_dimensions[9].height = 6
    for col in range(1, 9):
        ws.cell(row=9, column=col).fill = PatternFill('solid', start_color='1E3A5F')

    # ── TABLA DE ÍTEMS ────────────────────────────────────────
    HDR_ROW = 10
    ws.row_dimensions[HDR_ROW].height = 24
    headers = ['REF', 'DESCRIPCIÓN', 'UM', 'DESPACHADO', 'FACTURADO', 'X FACTURAR', 'VR. UNITARIO', 'TOTAL A COBRAR']
    aligns  = ['center','left','center','right','right','right','right','right']

    for col, (h, al) in enumerate(zip(headers, aligns), 1):
        c = ws.cell(row=HDR_ROW, column=col, value=h)
        c.font      = Font(name='Arial', bold=True, size=9, color=BLANCO)
        c.fill      = PatternFill('solid', start_color='1E3A5F')
        c.alignment = Alignment(horizontal=al, vertical='center')
        c.border    = brd

    items = data.get('items', [])
    DATA_START = HDR_ROW + 1

    for i, it in enumerate(items):
        row = DATA_START + i
        ws.row_dimensions[row].height = 18
        bg = BLANCO if i % 2 == 0 else GRIS1

        vals = [
            it.get('ref',''),
            it.get('descripcion',''),
            it.get('unidad','und'),
            it.get('despachado', 0),
            it.get('facturado', 0),
            it.get('xFact', 0),
            it.get('vrUnit', 0),
            it.get('totalFact', 0),
        ]
        fmts = [None, None, None, '#,##0', '#,##0', '#,##0', '$#,##0', '$#,##0']
        als  = ['center','left','center','right','right','right','right','right']
        bolds = [True, False, False, False, False, True, False, True]
        cols_  = ['1D4ED8', NEGRO, GRIS_TX, GRIS_TX, GRIS_TX, NEGRO, GRIS_TX, '1D4ED8']

        for col, (v, f, a, b, co) in enumerate(zip(vals, fmts, als, bolds, cols_), 1):
            c = ws.cell(row=row, column=col, value=v)
            c.font      = Font(name='Arial', bold=b, size=9, color=co)
            c.fill      = PatternFill('solid', start_color=bg)
            c.alignment = Alignment(horizontal=a, vertical='center')
            if f: c.number_format = f
            c.border = brd_nar if col == 1 else brd

    # ── TOTALES ───────────────────────────────────────────────
    LAST = DATA_START + len(items)
    TOT_ROW = LAST + 1
    ws.row_dimensions[TOT_ROW].height = 26

    ws.merge_cells(f'A{TOT_ROW}:E{TOT_ROW}')
    ct = ws[f'A{TOT_ROW}']
    ct.value = 'TOTAL PENDIENTE POR FACTURAR'
    ct.font  = Font(name='Arial', bold=True, size=11, color=BLANCO)
    ct.fill  = PatternFill('solid', start_color='1E3A5F')
    ct.alignment = Alignment(horizontal='right', vertical='center')
    ct.border = brd

    # x Facturar total
    xf_col = get_column_letter(6)
    xf_cell = ws.cell(row=TOT_ROW, column=6, value=f'=SUM({xf_col}{DATA_START}:{xf_col}{LAST})')
    xf_cell.font = Font(name='Arial', bold=True, size=11, color=BLANCO)
    xf_cell.fill = PatternFill('solid', start_color='1E3A5F')
    xf_cell.alignment = Alignment(horizontal='right', vertical='center')
    xf_cell.number_format = '#,##0'
    xf_cell.border = brd

    for col in [7]:
        ws.cell(row=TOT_ROW, column=col).fill = PatternFill('solid', start_color='1E3A5F')
        ws.cell(row=TOT_ROW, column=col).border = brd

    tot_cell = ws.cell(row=TOT_ROW, column=8, value=f'=SUM(H{DATA_START}:H{LAST})')
    tot_cell.font  = Font(name='Arial', bold=True, size=13, color=BLANCO)
    tot_cell.fill  = PatternFill('solid', start_color='1D4ED8')
    tot_cell.alignment = Alignment(horizontal='right', vertical='center')
    tot_cell.number_format = '$#,##0'
    tot_cell.border = brd

    # ── NOTA IVA ──────────────────────────────────────────────
    IVA_ROW = TOT_ROW + 1
    ws.row_dimensions[IVA_ROW].height = 40
    ws.merge_cells(f'A{IVA_ROW}:H{IVA_ROW}')
    nota = ws[f'A{IVA_ROW}']
    nota.value = (
        'NOTA: Los valores relacionados corresponden al valor del suministro sin IVA. '
        'El IVA (19%) será discriminado en la factura correspondiente.\n'
        'Santa Lucía Muebles y Pisos S.A.S. · NIT 900.602.879-5 · Tel: 311.341.04.58 · cesarbeta@gmail.com'
    )
    nota.font = Font(name='Arial', size=8, color=GRIS_TX, italic=True)
    nota.fill = PatternFill('solid', start_color='F1F5F9')
    nota.alignment = Alignment(horizontal='left', vertical='center', wrap_text=True, indent=1)

    # Freeze header
    ws.freeze_panes = f'A{DATA_START}'

    wb.save(output_path)
    print(f"Guardado: {output_path}")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        data = json.loads(sys.argv[1])
    else:
        # Datos de prueba
        data = {
            "proyecto": "M. LIVING SUITES",
            "constructora": "MUROS Y TECHOS S.A.S.",
            "contrato": "1320182",
            "tipo": "suministro",
            "fecha": "16/09/2026",
            "items": [
                {"ref":"P-01","descripcion":"P-01 ACCESO SUITES - Marco, contramarco, ala batiente en melamina RH","unidad":"un","despachado":20,"facturado":15,"xFact":5,"vrUnit":499790,"totalFact":2498950},
                {"ref":"P-02","descripcion":"P-02 BAÑOS SUITES - Marco, contramarco, ala batiente en melamina RH","unidad":"un","despachado":22,"facturado":22,"xFact":0,"vrUnit":499790,"totalFact":0},
                {"ref":"CLOSET-01","descripcion":"CLOSET 01 - Mueble interior 1.68 × 0.55 con 4 entrepaños, 2 cajones","unidad":"un","despachado":32,"facturado":20,"xFact":12,"vrUnit":1499790,"totalFact":17997480},
                {"ref":"ZOC","descripcion":"Zócalo en madera - EDIFICACION INMUEBLES","unidad":"ml","despachado":1500,"facturado":1000,"xFact":500,"vrUnit":17690,"totalFact":8845000},
            ]
        }
    output = '/tmp/informe_cobro_test.xlsx'
    generar_informe(data, output)
