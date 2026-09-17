import { callClaude } from '../lib/api.js'
import { useState, useRef } from 'react'
import { C, Btn, Inp, Sel, Txt, Modal, Badge, Empty, SectionHeader, card, fmt, fmtDate, Progress } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

const emptyPedido = { proyecto_id: '', numero: '', proveedor: '', fecha: '', estado: 'pendiente', notas: '' }
const emptyIngreso = { fecha: '', numero_factura: '', notas: '' }

const ESTADOS_P = {
  pendiente: { label: 'Pendiente', color: 'amber' },
  parcial:   { label: 'Parcial',   color: 'blue'  },
  completo:  { label: 'Completo',  color: 'green' },
}

// Proveedores se cargan desde dbData.proveedores

async function extraerItemsPedidoIA(archivo) {
  const base64 = await new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = () => res(reader.result.split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(archivo)
  })

  const esImagen = archivo.type.startsWith('image/')
  const mimeType = archivo.type || 'application/pdf'

  const prompt = `Eres un asistente que extrae ítems de pedidos de materiales de carpintería (tableros, madecantos, herrajes).
Del documento extrae TODOS los productos del pedido.

Para cada ítem devuelve:
- ref: referencia o código del producto (ej: DT6901415)
- descripcion: descripción completa del producto
- unidad: unidad de medida (UND, ML, KG, etc.)
- cantidad: cantidad pedida (número)
- vr_unitario: precio unitario NETO (después de descuentos, antes de IVA)
- m2_x_und: metros cuadrados por unidad si aparece (sino null)

También extrae del encabezado:
- numero_orden: número de orden de compra
- proveedor: nombre del proveedor/fabricante
- fecha: fecha del pedido (YYYY-MM-DD)
- total_sin_iva: subtotal o base de impuestos
- total_con_iva: total a pagar

Responde SOLO con JSON válido sin texto adicional:
{
  "numero_orden": "93494",
  "proveedor": "Dexco",
  "fecha": "2026-02-06",
  "total_sin_iva": 132019200,
  "total_con_iva": 157102848,
  "items": [
    {"ref": "DT6901415", "descripcion": "SUPERCOR PB SAGANO 15MM TF 183", "unidad": "UND", "cantidad": 320, "vr_unitario": 180900, "m2_x_und": 21.44}
  ]
}`

  const content = [
    esImagen
      ? { type: 'image',    source: { type: 'base64', media_type: mimeType, data: base64 } }
      : { type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } },
    { type: 'text', text: prompt }
  ]

  const data = await callClaude({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content }] })
  if (!data.content?.[0]?.text) throw new Error('Sin respuesta')
  const raw = data.content[0].text.trim()
  const ini = raw.indexOf('{'); let niv = 0, fin = ini
  for (let i = ini; i < raw.length; i++) {
    if (raw[i] === '{') niv++; else if (raw[i] === '}') { niv--; if (!niv) { fin = i+1; break } }
  }
  return JSON.parse(raw.slice(ini, fin))
}

export default function Pedidos({ dbData, setDbData, toast, nav, irA }) {
  const { pedidos = [], items_pedido = [], proyectos = [], constructoras = [], items_despacho = [], despachos = [], proveedores = [] } = dbData
  const navPedido = nav?.pedidoId ? pedidos.find(p => p.id === nav.pedidoId) : null

  const [vista, setVista]           = useState(navPedido ? 'detalle' : 'lista')
  const [pedidoSel, setPedidoSel]   = useState(navPedido || null)
  const [modalPedido, setModalPedido] = useState(false)
  const [modalIngreso, setModalIngreso] = useState(false)
  const [modalItemSel, setModalItemSel] = useState(null)
  const [form, setForm]             = useState(emptyPedido)
  const [formIngreso, setFormIngreso] = useState(emptyIngreso)
  const [editId, setEditId]         = useState(null)
  const [delId, setDelId]           = useState(null)
  const [filtProy, setFiltProy]     = useState('')

  // IA extracción
  const [archivo, setArchivo]       = useState(null)
  const [extrayendo, setExtrayendo] = useState(false)
  const [parsedItems, setParsedItems] = useState([])
  const [extractInfo, setExtractInfo] = useState(null)
  const [savingItems, setSavingItems] = useState(false)
  const [modalItems, setModalItems] = useState(false)
  const [modalManual, setModalManual] = useState(false)
  const [modalProveedor, setModalProveedor] = useState(false)
  const [formProveedor, setFormProveedor] = useState({ nombre: '', tipo: 'general', contacto: '', telefono: '', email: '' })
  const [itemsManual, setItemsManual] = useState([{ ref: '', descripcion: '', unidad: 'UND', cantidad: '', vr_unitario: '' }])
  const fileRef = useRef()

  const proyectoName = id => proyectos.find(p => p.id === id)?.nombre || '—'

  // Calcular cantidad recibida de un ítem
  const cantRecibida = (itemId) => {
    // Suma de ingresos registrados en items_despacho para este ítem de pedido
    return (items_despacho || [])
      .filter(d => d.item_pedido_id === itemId)
      .reduce((s, d) => s + (Number(d.cantidad) || 0), 0)
  }

  const pctRecibido = (pedidoId) => {
    const items = items_pedido.filter(i => i.pedido_id === pedidoId)
    if (!items.length) return 0
    const totalPed = items.reduce((s, i) => s + Number(i.cantidad_pedida || 0), 0)
    const totalRec = items.reduce((s, i) => s + cantRecibida(i.id), 0)
    return totalPed > 0 ? (totalRec / totalPed) * 100 : 0
  }

  const filtered = pedidos.filter(p => !filtProy || p.proyecto_id === filtProy)

  // ── CRUD Pedido ───────────────────────────────────────────
  function openNew()   { setForm({ ...emptyPedido }); setEditId(null); setModalPedido(true) }
  function openEdit(p) { setForm({ ...p }); setEditId(p.id); setModalPedido(true) }

  async function guardarPedido() {
    if (!form.proyecto_id) { toast('Selecciona el proyecto', 'err'); return }
    if (!form.fecha)       { toast('Ingresa la fecha', 'err'); return }
    try {
      if (editId) {
        const { data: u, error } = await supabase.from('pedidos').update(form).eq('id', editId).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, pedidos: d.pedidos.map(p => p.id === editId ? u : p) }))
        toast('Pedido actualizado', 'ok'); setModalPedido(false)
      } else {
        const { data: cr, error } = await supabase.from('pedidos').insert(form).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, pedidos: [...d.pedidos, cr] }))
        toast('Pedido creado', 'ok'); setModalPedido(false)
        setPedidoSel(cr); setVista('detalle')
        setTimeout(() => setModalItems(true), 200)
      }
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  async function eliminarPedido() {
    try {
      await supabase.from('items_pedido').delete().eq('pedido_id', delId)
      await supabase.from('pedidos').delete().eq('id', delId)
      setDbData(d => ({
        ...d,
        pedidos: d.pedidos.filter(p => p.id !== delId),
        items_pedido: d.items_pedido.filter(i => i.pedido_id !== delId),
      }))
      toast('Pedido eliminado', 'ok'); setDelId(null)
      if (vista === 'detalle') setVista('lista')
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  // ── IA extracción ─────────────────────────────────────────
  function abrirModalItems(pedido) {
    setPedidoSel(pedido); setArchivo(null); setParsedItems([]); setExtractInfo(null)
    setModalItems(true)
  }

  async function handleArchivoChange(e) {
    const f = e.target.files[0]; if (!f) return
    setArchivo(f); setParsedItems([]); setExtractInfo(null)
    setExtrayendo(true)
    try {
      toast('Analizando pedido con IA…', 'info')
      const res = await extraerItemsPedidoIA(f)
      const items = (res.items || []).map((it, i) => ({ ...it, orden: i+1 }))
      setParsedItems(items); setExtractInfo(res)
      // Auto-completar datos del pedido si los detectó
      if (pedidoSel && (res.numero_orden || res.proveedor || res.fecha)) {
        const upd = {}
        if (res.numero_orden) upd.numero = res.numero_orden
        if (res.proveedor)    upd.proveedor = res.proveedor
        if (res.fecha)        upd.fecha = res.fecha
        if (Object.keys(upd).length) {
          const { data: u } = await supabase.from('pedidos').update(upd).eq('id', pedidoSel.id).select().single()
          if (u) { setPedidoSel(u); setDbData(d => ({ ...d, pedidos: d.pedidos.map(p => p.id === u.id ? u : p) })) }
        }
      }
      toast(`${items.length} productos extraídos`, 'ok')
    } catch (e) { toast('Error extrayendo: ' + e.message, 'err') }
    setExtrayendo(false)
  }

  async function guardarItems() {
    if (!pedidoSel || !parsedItems.length) return
    setSavingItems(true)
    try {
      await supabase.from('items_pedido').delete().eq('pedido_id', pedidoSel.id)
      const rows = parsedItems.map(i => ({
        pedido_id: pedidoSel.id,
        ref: i.ref, descripcion: i.descripcion,
        material: i.descripcion, unidad: i.unidad,
        cantidad_pedida: i.cantidad, cantidad_recibida: 0,
        vr_unitario: i.vr_unitario,
      }))
      const { data, error } = await supabase.from('items_pedido').insert(rows).select()
      if (error) throw error
      setDbData(d => ({
        ...d,
        items_pedido: [...d.items_pedido.filter(i => i.pedido_id !== pedidoSel.id), ...data],
      }))
      toast(`${data.length} ítems guardados`, 'ok'); setModalItems(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSavingItems(false)
  }

  // ── Guardar proveedor nuevo ──────────────────────────────────
  async function guardarProveedor() {
    if (!formProveedor.nombre) { toast('Ingresa el nombre', 'err'); return }
    try {
      const { data, error } = await supabase.from('proveedores').insert(formProveedor).select().single()
      if (error) throw error
      setDbData(d => ({ ...d, proveedores: [...(d.proveedores||[]), data] }))
      setForm(f => ({ ...f, proveedor: data.nombre }))
      toast('Proveedor creado', 'ok'); setModalProveedor(false)
      setFormProveedor({ nombre: '', tipo: 'general', contacto: '', telefono: '', email: '' })
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  // ── Ingreso manual de ítems ───────────────────────────────
  function addFilaManual() {
    setItemsManual(rows => [...rows, { ref: '', descripcion: '', unidad: 'UND', cantidad: '', vr_unitario: '' }])
  }
  function updateFilaManual(idx, field, val) {
    setItemsManual(rows => rows.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }
  function removeFilaManual(idx) {
    setItemsManual(rows => rows.filter((_, i) => i !== idx))
  }

  async function guardarItemsManual() {
    const validos = itemsManual.filter(i => i.descripcion && Number(i.cantidad) > 0)
    if (!validos.length) { toast('Agrega al menos un ítem con descripción y cantidad', 'err'); return }
    setSavingItems(true)
    try {
      await supabase.from('items_pedido').delete().eq('pedido_id', pedidoSel.id)
      const rows = validos.map((i, idx) => ({
        pedido_id: pedidoSel.id,
        ref: i.ref || null,
        descripcion: i.descripcion,
        material: i.descripcion,
        unidad: i.unidad || 'UND',
        cantidad_pedida: Number(i.cantidad),
        cantidad_recibida: 0,
        vr_unitario: Number(i.vr_unitario) || 0,
      }))
      const { data, error } = await supabase.from('items_pedido').insert(rows).select()
      if (error) throw error
      setDbData(d => ({
        ...d,
        items_pedido: [...d.items_pedido.filter(i => i.pedido_id !== pedidoSel.id), ...data],
      }))
      toast(`${data.length} ítems guardados`, 'ok')
      setModalManual(false)
      setItemsManual([{ ref: '', descripcion: '', unidad: 'UND', cantidad: '', vr_unitario: '' }])
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSavingItems(false)
  }

  // ── Registrar ingreso de material ─────────────────────────
  function abrirIngreso(item) { setModalItemSel(item); setFormIngreso(emptyIngreso); setModalIngreso(true) }

  async function guardarIngreso() {
    if (!formIngreso.cantidad || !formIngreso.fecha) { toast('Ingresa fecha y cantidad', 'err'); return }
    try {
      const row = {
        despacho_id: null,
        item_pedido_id: modalItemSel.id,
        cantidad: Number(formIngreso.cantidad),
      }
      // Crear un despacho-ingreso si no existe uno del día
      let despachoId = null
      const { data: d2, error: e2 } = await supabase.from('despachos').insert({
        proyecto_id: pedidoSel.proyecto_id,
        fecha: formIngreso.fecha,
        numero: formIngreso.numero_factura || null,
        notas: formIngreso.notas || null,
      }).select().single()
      if (e2) throw e2
      despachoId = d2.id
      row.despacho_id = despachoId

      const { data: ing, error: e3 } = await supabase.from('items_despacho').insert(row).select().single()
      if (e3) throw e3

      setDbData(d => ({
        ...d,
        despachos: [...(d.despachos||[]), d2],
        items_despacho: [...(d.items_despacho||[]), ing],
      }))
      toast('Ingreso registrado', 'ok'); setModalIngreso(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  // ── Vista detalle ─────────────────────────────────────────
  if (vista === 'detalle' && pedidoSel) {
    const items = items_pedido.filter(i => i.pedido_id === pedidoSel.id)
    const proyecto = proyectos.find(p => p.id === pedidoSel.proyecto_id)
    const pct = pctRecibido(pedidoSel.id)
    const totalPedido = items.reduce((s, i) => s + Number(i.cantidad_pedida||0) * Number(i.vr_unitario||0), 0)
    const ivaPedido = totalPedido * 0.19
    const totalConIvaPedido = totalPedido + ivaPedido

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Btn onClick={() => setVista('lista')}>← Pedidos</Btn>
          {nav?.desde === 'proyecto' && irA && <Btn variant="primary" onClick={() => irA('proyectos', { proyectoId: nav.proyectoId })}>← Volver al proyecto</Btn>}
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              📦 Pedido {pedidoSel.numero || 'Sin número'} — {proyecto?.nombre}
            </h1>
            <div style={{ fontSize: 13, color: C.g5 }}>
              {pedidoSel.proveedor || 'Sin proveedor'} · {fmtDate(pedidoSel.fecha)}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Btn onClick={() => { setItemsManual(items.length ? items.map(i => ({ ref: i.ref||'', descripcion: i.descripcion||i.material||'', unidad: i.unidad||'UND', cantidad: i.cantidad_pedida||'', vr_unitario: i.vr_unitario||'' })) : [{ ref: '', descripcion: '', unidad: 'UND', cantidad: '', vr_unitario: '' }]); setModalManual(true) }}>
              ✏️ Manual
            </Btn>
            <Btn onClick={() => abrirModalItems(pedidoSel)}>
              📎 Cargar PDF
            </Btn>
            <Btn onClick={() => openEdit(pedidoSel)}>Editar</Btn>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
          <div style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Total pedido (con IVA)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(totalConIvaPedido)}</div>
            <div style={{ fontSize: 11, color: C.g5 }}>{items.length} referencias · sin IVA: {fmt(totalPedido)}</div>
          </div>
          <div style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Recibido</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.gnD }}>
              {items.reduce((s,i) => s + cantRecibida(i.id), 0).toLocaleString('es-CO')} und
            </div>
          </div>
          <div style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Pendiente</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.am }}>
              {items.reduce((s,i) => s + Math.max(0, Number(i.cantidad_pedida||0) - cantRecibida(i.id)), 0).toLocaleString('es-CO')} und
            </div>
          </div>
          <div style={{ ...card, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: C.g4, marginBottom: 6 }}>Avance recepción</div>
            <Progress value={pct} />
          </div>
        </div>

        {items.length === 0 ? (
          <Empty icon="📦" title="Sin ítems" desc="Carga el PDF del pedido para extraer los productos automáticamente."
            action={<Btn variant="primary" onClick={() => abrirModalItems(pedidoSel)}>📎 Cargar pedido (PDF/JPG)</Btn>} />
        ) : (
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.g0 }}>
                  {['Ref','Descripción','UM','Pedido','Recibido','Pendiente','Vr. Neto','Acciones'].map((h,i) => (
                    <th key={i} style={{ padding: '10px 12px', textAlign: i > 2 && i < 7 ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: `2px solid ${C.g2}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const rec = cantRecibida(item.id)
                  const ped = Number(item.cantidad_pedida || 0)
                  const pend = Math.max(0, ped - rec)
                  const completo = rec >= ped
                  return (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${C.g1}`, background: completo ? '#F0FDF4' : '' }}>
                      <td style={{ padding: '9px 12px', fontWeight: 600, color: C.or, whiteSpace: 'nowrap' }}>{item.ref || '—'}</td>
                      <td style={{ padding: '9px 12px', maxWidth: 300 }}>{item.descripcion || item.material}</td>
                      <td style={{ padding: '9px 12px', color: C.g5 }}>{item.unidad}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>{ped.toLocaleString('es-CO')}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', color: C.gnD, fontWeight: 600 }}>{rec.toLocaleString('es-CO')}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', color: pend > 0 ? C.am : C.gnD, fontWeight: 600 }}>{pend.toLocaleString('es-CO')}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right' }}>{fmt(item.vr_unitario)}</td>
                      <td style={{ padding: '9px 12px' }}>
                        {!completo && (
                          <Btn size="sm" variant="success" onClick={() => abrirIngreso(item)}>
                            + Ingreso
                          </Btn>
                        )}
                        {completo && <span style={{ fontSize: 12, color: C.gnD }}>✓ Completo</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: C.g0, borderTop: `2px solid ${C.g2}` }}>
                  <td colSpan={3} style={{ padding: '9px 12px', fontWeight: 700 }}>SUBTOTAL</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>
                    {items.reduce((s,i) => s + Number(i.cantidad_pedida||0), 0).toLocaleString('es-CO')}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: C.gnD }}>
                    {items.reduce((s,i) => s + cantRecibida(i.id), 0).toLocaleString('es-CO')}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: C.am }}>
                    {items.reduce((s,i) => s + Math.max(0, Number(i.cantidad_pedida||0) - cantRecibida(i.id)), 0).toLocaleString('es-CO')}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>{fmt(totalPedido)}</td>
                  <td />
                </tr>
                <tr style={{ background: C.g0 }}>
                  <td colSpan={6} style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'right', color: C.g5 }}>IVA 19%</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: C.g5 }}>{fmt(ivaPedido)}</td>
                  <td />
                </tr>
                <tr style={{ background: C.g0, borderTop: `1px solid ${C.g2}` }}>
                  <td colSpan={6} style={{ padding: '10px 12px', fontWeight: 800, textAlign: 'right' }}>TOTAL CON IVA</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: C.gnD, fontSize: 15 }}>{fmt(totalConIvaPedido)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Modal ingreso manual */}
        {modalManual && (
          <Modal title="Ítems del pedido — entrada manual" onClose={() => setModalManual(false)} wide fullscreen>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 700 }}>
                <thead>
                  <tr style={{ background: C.g0 }}>
                    {['Ref','Descripción *','UM','Cantidad *','Vr. Unitario',''].map((h,i) => (
                      <th key={i} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.g5, borderBottom: `2px solid ${C.g2}`, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itemsManual.map((row, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.g1}` }}>
                      <td style={{ padding: '6px 8px', width: 100 }}>
                        <input value={row.ref} onChange={e => updateFilaManual(i,'ref',e.target.value)} placeholder="DT6901415" style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12 }} />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input value={row.descripcion} onChange={e => updateFilaManual(i,'descripcion',e.target.value)} placeholder="Descripción del material" style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12 }} />
                      </td>
                      <td style={{ padding: '6px 8px', width: 80 }}>
                        <select value={row.unidad} onChange={e => updateFilaManual(i,'unidad',e.target.value)} style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12, background: C.wh }}>
                          {['UND','ML','M2','KG','GL','PAR'].map(u => <option key={u}>{u}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', width: 100 }}>
                        <input type="number" value={row.cantidad} onChange={e => updateFilaManual(i,'cantidad',e.target.value)} placeholder="0" style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12, textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: '6px 8px', width: 130 }}>
                        <input type="number" value={row.vr_unitario} onChange={e => updateFilaManual(i,'vr_unitario',e.target.value)} placeholder="0" style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.g2}`, borderRadius: 6, fontSize: 12, textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: '6px 8px', width: 40 }}>
                        {itemsManual.length > 1 && (
                          <button onClick={() => removeFilaManual(i)} style={{ background: 'none', border: 'none', color: C.rd, cursor: 'pointer', fontSize: 18, padding: '2px 6px' }}>×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Btn onClick={addFilaManual}>+ Agregar fila</Btn>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <Btn onClick={() => setModalManual(false)}>Cancelar</Btn>
              <Btn variant="primary" onClick={guardarItemsManual} disabled={savingItems}>
                {savingItems ? 'Guardando…' : `✓ Guardar ${itemsManual.filter(i => i.descripcion).length} ítems`}
              </Btn>
            </div>
          </Modal>
        )}

        {/* Modal cargar PDF */}
        {modalItems && (
          <Modal title="Cargar ítems del pedido" onClose={() => setModalItems(false)} wide>
            <div onClick={() => fileRef.current?.click()} style={{
              border: `2px dashed ${archivo ? C.gnD : C.g3}`, borderRadius: 12,
              padding: '2rem', textAlign: 'center', cursor: 'pointer',
              background: archivo ? C.gnL : C.g0, marginBottom: 16,
            }}>
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleArchivoChange} />
              {extrayendo ? (
                <div>
                  <div style={{ width: 36, height: 36, border: `3px solid ${C.g2}`, borderTopColor: C.or, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                  <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  <div style={{ fontWeight: 600, color: C.or }}>Analizando pedido con IA…</div>
                </div>
              ) : archivo ? (
                <div>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                  <div style={{ fontWeight: 600, color: C.gnD }}>{archivo.name}</div>
                  <div style={{ fontSize: 12, color: C.g5, marginTop: 4 }}>Clic para cambiar</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>📎</div>
                  <div style={{ fontWeight: 600 }}>Arrastra el PDF o imagen del pedido aquí</div>
                  <div style={{ fontSize: 13, color: C.g5, marginTop: 6 }}>PDF, JPG, PNG</div>
                </div>
              )}
            </div>

            {extractInfo && !extrayendo && (
              <div style={{ background: C.gnL, border: `1px solid #BBF7D0`, borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
                <strong style={{ color: C.gnD }}>✓ IA extrajo:</strong>
                <span style={{ color: C.gnD, marginLeft: 8 }}>
                  {parsedItems.length} productos
                  {extractInfo.numero_orden ? ` · Orden #${extractInfo.numero_orden}` : ''}
                  {extractInfo.proveedor ? ` · ${extractInfo.proveedor}` : ''}
                  {extractInfo.total_con_iva ? ` · Total: ${fmt(extractInfo.total_con_iva)}` : ''}
                </span>
              </div>
            )}

            {parsedItems.length > 0 && (
              <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${C.g2}`, borderRadius: 8, marginBottom: 16 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead style={{ background: C.g0, position: 'sticky', top: 0 }}>
                    <tr>
                      {['Ref','Descripción','UM','Cantidad','Vr. Neto','Total'].map((h,i) => (
                        <th key={i} style={{ padding: '8px 10px', textAlign: i > 2 ? 'right' : 'left', fontSize: 11, color: C.g5, fontWeight: 700, borderBottom: `1px solid ${C.g2}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedItems.map((it, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.g1}` }}>
                        <td style={{ padding: '7px 10px', fontWeight: 600, color: C.or }}>{it.ref}</td>
                        <td style={{ padding: '7px 10px', maxWidth: 260 }}>{it.descripcion}</td>
                        <td style={{ padding: '7px 10px', color: C.g5 }}>{it.unidad}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{Number(it.cantidad).toLocaleString('es-CO')}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmt(it.vr_unitario)}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>{fmt(Number(it.cantidad)*Number(it.vr_unitario))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ borderTop: `1px solid ${C.g2}`, marginTop: 16, paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Btn onClick={() => { setModalItems(false); setItemsManual([{ ref: '', descripcion: '', unidad: 'UND', cantidad: '', vr_unitario: '' }]); setModalManual(true) }}>
                ✏️ Ingresar manual
              </Btn>
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn onClick={() => setModalItems(false)}>Cancelar</Btn>
                {parsedItems.length > 0 && (
                  <Btn variant="primary" onClick={guardarItems} disabled={savingItems}>
                    {savingItems ? 'Guardando…' : `✓ Guardar ${parsedItems.length} productos`}
                  </Btn>
                )}
              </div>
            </div>
          </Modal>
        )}

        {/* Modal registrar ingreso */}
        {modalIngreso && modalItemSel && (
          <Modal title="Registrar ingreso de material" onClose={() => setModalIngreso(false)}>
            <div style={{ ...card, background: C.g0, marginBottom: 16, padding: '12px 16px' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{modalItemSel.ref} — {modalItemSel.descripcion || modalItemSel.material}</div>
              <div style={{ fontSize: 12, color: C.g5, marginTop: 4, display: 'flex', gap: 16 }}>
                <span>Pedido: <strong>{Number(modalItemSel.cantidad_pedida).toLocaleString('es-CO')}</strong></span>
                <span>Recibido: <strong style={{ color: C.gnD }}>{cantRecibida(modalItemSel.id).toLocaleString('es-CO')}</strong></span>
                <span>Pendiente: <strong style={{ color: C.am }}>{Math.max(0, Number(modalItemSel.cantidad_pedida) - cantRecibida(modalItemSel.id)).toLocaleString('es-CO')}</strong></span>
              </div>
            </div>
            <Inp label="Fecha de ingreso *" type="date" value={formIngreso.fecha}
              onChange={e => setFormIngreso(f => ({ ...f, fecha: e.target.value }))} />
            <Inp label="Cantidad recibida *" type="number" value={formIngreso.cantidad || ''}
              onChange={e => setFormIngreso(f => ({ ...f, cantidad: e.target.value }))}
              placeholder={`Máx: ${Math.max(0, Number(modalItemSel.cantidad_pedida) - cantRecibida(modalItemSel.id))}`} />
            <Inp label="Número de factura / remisión" value={formIngreso.numero_factura || ''}
              onChange={e => setFormIngreso(f => ({ ...f, numero_factura: e.target.value }))}
              placeholder="Ej: FAC-2026-001234" />
            <Txt label="Notas" value={formIngreso.notas || ''}
              onChange={e => setFormIngreso(f => ({ ...f, notas: e.target.value }))}
              placeholder="Observaciones del ingreso..." />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <Btn onClick={() => setModalIngreso(false)}>Cancelar</Btn>
              <Btn variant="primary" onClick={guardarIngreso}>Registrar ingreso</Btn>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // ── Vista lista ───────────────────────────────────────────
  return (
    <div>
      <SectionHeader title="Pedidos de materiales">
        <Btn variant="primary" onClick={openNew}>+ Nuevo pedido</Btn>
      </SectionHeader>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <select value={filtProy} onChange={e => setFiltProy(e.target.value)}
          style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
          <option value="">Todos los proyectos</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <Empty icon="📦" title="Sin pedidos" desc="Registra el primer pedido de materiales para un proyecto."
          action={<Btn variant="primary" onClick={openNew}>+ Nuevo pedido</Btn>} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(p => {
            const items = items_pedido.filter(i => i.pedido_id === p.id)
            const pct = pctRecibido(p.id)
            const est = pct === 0 ? 'pendiente' : pct >= 100 ? 'completo' : 'parcial'
            const estV = ESTADOS_P[est]
            return (
              <div key={p.id} style={{
                ...card, cursor: 'pointer',
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center',
                borderLeft: `4px solid ${est === 'completo' ? C.gn : est === 'parcial' ? C.bl : C.am}`,
              }}
                onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.1)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.06)'}
                onClick={() => { setPedidoSel(p); setVista('detalle') }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>
                      {p.numero ? `Pedido #${p.numero}` : 'Pedido sin número'}
                    </span>
                    <Badge color={estV.color}>{estV.label}</Badge>
                    {items.length > 0 && <span style={{ fontSize: 12, color: C.g5 }}>{items.length} referencias</span>}
                  </div>
                  <div style={{ fontSize: 13, color: C.g5, marginBottom: 8 }}>
                    🏗️ {proyectoName(p.proyecto_id)}
                    {p.proveedor && ` · 🏭 ${p.proveedor}`}
                    {p.fecha && ` · 📅 ${fmtDate(p.fecha)}`}
                  </div>
                  <Progress value={pct} />
                </div>
                <div style={{ textAlign: 'right', minWidth: 140 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>
                    {fmt(items.reduce((s,i) => s + Number(i.cantidad_pedida||0)*Number(i.vr_unitario||0), 0))}
                  </div>
                  <div style={{ fontSize: 12, color: C.g5, marginBottom: 8 }}>{Math.round(pct)}% recibido</div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                    <Btn size="sm" onClick={() => openEdit(p)}>Editar</Btn>
                    <Btn size="sm" variant="danger" onClick={() => setDelId(p.id)}>Eliminar</Btn>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal crear/editar */}
      {modalPedido && (
        <Modal title={editId ? 'Editar pedido' : 'Nuevo pedido'} onClose={() => setModalPedido(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Sel label="Proyecto *" value={form.proyecto_id} onChange={e => setForm(f => ({ ...f, proyecto_id: e.target.value }))}>
                <option value="">— Seleccionar proyecto —</option>
                {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </Sel>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: C.g5, display: 'block', marginBottom: 5, fontWeight: 500 }}>Proveedor</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={form.proveedor||''} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))}
                  style={{ flex: 1, padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
                  <option value="">— Seleccionar —</option>
                  {proveedores.filter(p => p.activo).sort((a,b) => a.nombre.localeCompare(b.nombre)).map(p => (
                    <option key={p.id} value={p.nombre}>{p.nombre}{p.tipo !== 'general' ? ` (${p.tipo})` : ''}</option>
                  ))}
                </select>
                <Btn size="sm" onClick={() => setModalProveedor(true)}>+ Nuevo</Btn>
              </div>
            </div>
            <Inp label="Número de orden" value={form.numero||''} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} placeholder="Ej: 93494" />
            <Inp label="Fecha del pedido *" type="date" value={form.fecha||''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            <div />
            <div style={{ gridColumn: '1/-1' }}>
              <Txt label="Notas" value={form.notas||''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones del pedido..." />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <Btn onClick={() => setModalPedido(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardarPedido}>{editId ? 'Guardar' : 'Crear y cargar PDF →'}</Btn>
          </div>
        </Modal>
      )}

      {/* Modal nuevo proveedor */}
      {modalProveedor && (
        <Modal title="Nuevo proveedor" onClose={() => setModalProveedor(false)}>
          <Inp label="Nombre *" value={formProveedor.nombre} onChange={e => setFormProveedor(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Primadera" />
          <Sel label="Tipo" value={formProveedor.tipo} onChange={e => setFormProveedor(f => ({ ...f, tipo: e.target.value }))}>
            <option value="tableros">Tableros</option>
            <option value="madecantos">Madecantos</option>
            <option value="herrajes">Herrajes</option>
            <option value="general">General</option>
          </Sel>
          <Inp label="Contacto" value={formProveedor.contacto||''} onChange={e => setFormProveedor(f => ({ ...f, contacto: e.target.value }))} />
          <Inp label="Teléfono" value={formProveedor.telefono||''} onChange={e => setFormProveedor(f => ({ ...f, telefono: e.target.value }))} />
          <Inp label="Email" value={formProveedor.email||''} onChange={e => setFormProveedor(f => ({ ...f, email: e.target.value }))} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <Btn onClick={() => setModalProveedor(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardarProveedor}>Crear proveedor</Btn>
          </div>
        </Modal>
      )}

      {delId && (
        <Modal title="Eliminar pedido" onClose={() => setDelId(null)}>
          <p style={{ fontSize: 14, marginBottom: 8 }}>¿Eliminar este pedido y todos sus ítems?</p>
          <p style={{ fontSize: 13, color: C.rd, marginBottom: 20 }}>Esta acción no se puede deshacer.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Btn onClick={() => setDelId(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={eliminarPedido}>Sí, eliminar</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
