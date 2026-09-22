import { useState } from 'react'
import { C, Btn, Inp, Sel, Txt, Modal, Badge, Empty, SectionHeader, card, fmt, fmtDate, Progress, Stat } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'
import * as XLSX from 'xlsx'

const emptyForm = { nombre: '', constructora_id: '', estado: 'activo', fecha_inicio: '', fecha_fin: '', notas: '' }
const ESTADOS = {
  activo:    { label: 'Activo',    color: 'green' },
  pausado:   { label: 'Pausado',   color: 'amber' },
  terminado: { label: 'Terminado', color: 'gray'  },
}
const ROL_FINANCIERO = ['superadmin', 'facturacion', 'supervisor', 'contratos']

export default function Proyectos({ dbData, setDbData, toast, user, nav, irA, puedeIr }) {
  const {
    proyectos = [], constructoras = [], contratos = [],
    items_contrato = [], actas_facturacion = [],
    pedidos = [], items_pedido = [], ingresos_material = [],
    adicionales = [], remisiones = [], items_remision = [],
    lotes_produccion = [], items_lote = [],
    obras = [], subitems_instalacion = [], liquidaciones = [],
  } = dbData

  const navProy = nav?.proyectoId ? proyectos.find(p => p.id === nav.proyectoId) : null
  const [vista, setVista]         = useState(navProy ? 'dashboard' : 'lista')
  const [proySel, setProySel]     = useState(navProy || null)
  const [corteDet, setCorteDet]   = useState(null)
  const [retDet, setRetDet]       = useState(null)     // reporte de retenidos por instalador
  const [modalObra, setModalObra] = useState(false)
  const [obraForm, setObraForm]   = useState('')
  const [torresTmp, setTorresTmp] = useState([])     // obras (torres) mientras se editan
  const [nombreTorre, setNombreTorre] = useState('')
  const [savingObra, setSavingObra] = useState(false)
  const [modal, setModal]         = useState(false)
  const [form, setForm]           = useState(emptyForm)
  const [editId, setEditId]       = useState(null)
  const [delId, setDelId]         = useState(null)
  const [search, setSearch]       = useState('')
  const [filtConst, setFiltConst] = useState('')
  const [filtEst, setFiltEst]     = useState('')

  const verFinanzas = ROL_FINANCIERO.includes(user?.rol)
  const verFact     = puedeIr ? puedeIr('facturacion') : false
  const verContr    = puedeIr ? puedeIr('contratos') : false

  // ── Obras (torres) de Gestión de Obras vinculadas al proyecto ──
  // Un contrato puede ejecutarse en varias torres; cada torre es una obra en Gestión.
  const obrasDeProy = p => [...new Set([...(p?.obras_ids || []), p?.obra_id].filter(Boolean))]

  function abrirTorres() {
    setTorresTmp(obrasDeProy(proySel))
    setObraForm('')
    const n = obrasDeProy(proySel).length + 1
    setNombreTorre(`${proySel?.nombre || ''} TORRE ${n}`.trim())
    setModalObra(true)
  }

  // Los elementos que salieron del contrato deben verse en todas las torres
  async function sincronizarElementos(torres) {
    const cts = contratos.filter(c => c.proyecto_id === proySel.id).map(c => c.id)
    const itemIds = items_contrato.filter(i => cts.includes(i.contrato_id)).map(i => i.id)
    const eids = [...new Set(subitems_instalacion.filter(p => itemIds.includes(p.item_contrato_id) && p.elemento_id).map(p => p.elemento_id))]
    const cambiados = []
    for (const eid of eids) {
      const el = (dbData.elementos || []).find(e => e.id === eid)
      if (!el) continue
      const extra = torres.filter(t => t !== el.obra_id)
      const { data } = await supabase.from('elementos').update({ obras_extra: extra }).eq('id', eid).select().single()
      if (data) cambiados.push(data)
    }
    if (cambiados.length) setDbData(d => ({ ...d, elementos: (d.elementos || []).map(e => cambiados.find(c => c.id === e.id) || e) }))
  }

  async function guardarTorres(torres) {
    setSavingObra(true)
    try {
      const { data, error } = await supabase.from('proyectos')
        .update({ obras_ids: torres, obra_id: torres[0] || null }).eq('id', proySel.id).select().single()
      if (error) throw error
      setDbData(d => ({ ...d, proyectos: d.proyectos.map(p => p.id === data.id ? data : p) }))
      setProySel(data)
      await sincronizarElementos(torres)
      toast('Torres guardadas', 'ok')
      setModalObra(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSavingObra(false)
  }

  async function crearTorreEnGestion() {
    const nombre = nombreTorre.trim()
    if (!nombre) { toast('Escribe el nombre de la torre', 'err'); return }
    setSavingObra(true)
    try {
      const nueva = {
        id: `o${Date.now()}`, nombre, direccion: '',
        estado: 'activa', pisos: [], tipologias: [],
        instaladores_autorizados: [], aptos_habilitados: {}, solicitudes: [], precios_override: {},
        coordinador_id: '',
      }
      const { data: obraCreada, error } = await supabase.from('obras').insert(nueva).select().single()
      if (error) throw error
      setDbData(d => ({ ...d, obras: [...(d.obras || []), obraCreada] }))
      setTorresTmp(t => [...t, obraCreada.id])
      toast(`"${nombre}" creada en Gestión de Obras. Dale Guardar para dejarla vinculada.`, 'ok')
    } catch (e) { toast('Error: ' + e.message, 'err') }
    setSavingObra(false)
  }

  // ── Instalación: costo y margen (solo para quien ve facturación) ──
  const esDetallado = r => String(r.actividad || '') === 'Detallado' || String(r.el || '').startsWith('[Detallado]')
  const esAdicional = r => String(r.el || '').startsWith('[Adicional]')
  const esDia       = r => String(r.el || '') === 'Día laborado' || String(r.actividad || '') === 'Día laborado'

  // Adicionales marcados en Gestión, según de quién son (el ERP puede corregir la clasificación)
  function adicionalesPorResponsable(proy) {
    const res = { obra: 0, santalucia: 0, sin: 0, nSL: 0 }
    for (const t of obrasDeProy(proy).map(id => obras.find(o => o.id === id)).filter(Boolean)) {
      for (const p of t.pisos || []) for (const a of p.aptos || []) {
        const lista = [...(a.elementos || []), ...(a.elementosExtra || [])]
        lista.forEach((el, i) => {
          if (!el.esAdicional || !el.completado) return
          const ref = `${t.id}|${a.id}|${el.descripcion || ''}|${el.fecha || ''}|${i}`
          const reg = adicionales.find(x => x.gestion_ref === ref)
          const resp = reg?.responsable || el.responsable || 'sin'
          const v = Number(el.valorUnitario || 0) * Number(el.cantidad || 1)
          res[resp] = (res[resp] || 0) + v
          if (resp === 'santalucia') res.nSL++
        })
      }
    }
    return res
  }

  function costoInstalacion(proy) {
    const torres = obrasDeProy(proy).map(id => obras.find(o => o.id === id)).filter(Boolean)
    if (!torres.length) return null
    const obra = { nombre: torres.map(t => t.nombre).join(' + '), pisos: torres.flatMap(t => t.pisos || []) }
    const nombresTorres = torres.map(t => t.nombre)
    const cts = contratos.filter(c => c.proyecto_id === proy.id && ['instalacion', 'todo_costo'].includes(c.tipo))
    const its = items_contrato.filter(i => cts.some(c => c.id === i.contrato_id))
    const elsDeItem = itemId => subitems_instalacion.filter(p => p.item_contrato_id === itemId && p.elemento_id).map(p => p.elemento_id)
    const aptos = (obra.pisos || []).flatMap(p => p.aptos || [])
    const instaladoItem = itemId => {
      const eids = elsDeItem(itemId)
      if (!eids.length) return 0
      return aptos.reduce((s2, a) => {
        const todos = [...(a.elementos || []), ...(a.elementosExtra || [])]
        let min = Infinity
        for (const eid of eids) {
          min = Math.min(min, todos.filter(e => e.elementoId === eid && e.completado).reduce((x, e) => x + Number(e.cantidad || 1), 0))
        }
        return s2 + (min === Infinity ? 0 : min)
      }, 0)
    }
    const valorInstalado = its.reduce((s2, it) => s2 + instaladoItem(it.id) * Number(it.vr_unitario || 0), 0)

    const cortes = {}
    const porPersona = {}   // retenidos acumulados por instalador en esta obra
    for (const l of liquidaciones) {
      const filas = (l.rows || []).filter(r => nombresTorres.includes(r.obra || ''))
      if (!filas.length) continue
      const val = fs => fs.reduce((x, r) => x + Number(r.precio || 0) * Number(r.cant || 1), 0)
      const c = cortes[l.corte] || (cortes[l.corte] = { corte: l.corte, inst: 0, det: 0, adic: 0, dia: 0, dias: 0, personas: [] })
      const filasDia = filas.filter(r => esDia(r) && r.apr !== false)
      const inst = val(filas.filter(r => !esDetallado(r) && !esAdicional(r) && !esDia(r)))
      const det = val(filas.filter(esDetallado))
      const adic = val(filas.filter(esAdicional))
      const dia = val(filasDia)
      const dias = filasDia.reduce((x, r) => x + Number(r.cant || 0), 0)
      // Retención: el 10% de lo causado en ESTA obra (instalación + detallado + adicionales).
      // Los días laborados, pasajes y bonificación no llevan retención.
      const brutoObra = inst + det + adic
      const retObra = Math.round(brutoObra * 0.10)
      c.inst += inst; c.det += det; c.adic += adic; c.dia += dia; c.dias += dias; c.ret = (c.ret || 0) + retObra
      const kP = l.inst_id || l.inst_nombre
      const pp = porPersona[kP] || (porPersona[kP] = { nombre: l.inst_nombre || '—', cedula: l.inst_cedula, causado: 0, ret: 0, cortes: [] })
      pp.causado += brutoObra; pp.ret += retObra
      pp.cortes.push({ corte: l.corte, causado: brutoObra, ret: retObra })
      c.personas.push({
        nombre: l.inst_nombre, inst, det, adic, dia, dias,
        ret: retObra, neto: brutoObra - retObra + dia,
        pas: Number(l.pasajes ?? l.pas ?? 0), bon: Number(l.bonificacion ?? l.bon ?? 0),
        totalCorte: Number(l.total || 0), soloEstaObra: filas.length === (l.rows || []).length,
      })
    }
    const lista = Object.values(cortes).sort((a, b) => String(b.corte).localeCompare(String(a.corte)))
    const pagado = lista.reduce((s2, c) => s2 + c.inst + c.det + c.adic + c.dia, 0)
    const diasTot = lista.reduce((s2, c) => s2 + c.dias, 0)
    const diasVal = lista.reduce((s2, c) => s2 + c.dia, 0)
    const retTot  = lista.reduce((s2, c) => s2 + (c.ret || 0), 0)
    const retenidos = Object.values(porPersona).filter(p => p.ret > 0).sort((a, b) => b.ret - a.ret)
    return { obra, valorInstalado, pagado, margen: valorInstalado - pagado, cortes: lista, diasTot, diasVal, retTot, retenidos }
  }

  // ── Exportar el reporte de retenidos a Excel ──────────────
  function exportarRetenidos(ci) {
    const filas = [
      [`Retenidos por instalador — ${ci.obra?.nombre || ''}`],
      [`Proyecto: ${proySel?.nombre || ''}`, '', '', `Generado: ${new Date().toLocaleDateString('es-CO')}`],
      [],
      ['Instalador', 'Cédula', 'Corte', 'Causado en la obra', 'Retenido 10%'],
    ]
    for (const p of ci.retenidos) {
      for (const c of p.cortes.filter(x => x.ret > 0)) {
        filas.push([p.nombre, p.cedula || '', c.corte, c.causado, c.ret])
      }
      filas.push(['', '', `Total ${p.nombre}`, p.causado, p.ret])
      filas.push([])
    }
    filas.push(['TOTAL RETENIDO EN LA OBRA', '', '', ci.retenidos.reduce((x, p) => x + p.causado, 0), ci.retTot])

    const hoja = XLSX.utils.aoa_to_sheet(filas)
    hoja['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 30 }, { wch: 20 }, { wch: 16 }]
    // formato de pesos en las columnas de valores
    const rango = XLSX.utils.decode_range(hoja['!ref'])
    for (let r = 4; r <= rango.e.r; r++) {
      for (const col of [3, 4]) {
        const celda = hoja[XLSX.utils.encode_cell({ r, c: col })]
        if (celda && typeof celda.v === 'number') celda.z = '"$"#,##0'
      }
    }
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, 'Retenidos')
    const nombre = `Retenidos ${ci.obra?.nombre || 'obra'} ${new Date().toISOString().slice(0, 10)}.xlsx`.replace(/[\\/:*?"<>|]/g, '')
    XLSX.writeFile(libro, nombre)
  }

  // ── Navegación a otros módulos desde el dashboard ─────────
  const puede = key => (puedeIr ? puedeIr(key) : false) && !!irA
  const ir = (key, params) => irA && irA(key, { ...params, proyectoId: proySel?.id, desde: 'proyecto' })
  const clic = key => puede(key) ? {
    onMouseEnter: e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.12)' },
    onMouseLeave: e => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,.06)' },
  } : {}
  const Flecha = ({ k }) => puede(k) ? <span style={{ color: C.g4, fontSize: 14, marginLeft: 8 }}>›</span> : null
  const h3 = { margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
  const linkMod = (key, texto) => puede(key)
    ? <span onClick={() => ir(key, {})} style={{ fontSize: 11, color: C.bl || '#1D4ED8', cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>{texto} →</span>
    : null

  const totalFacturado = cid =>
    actas_facturacion.filter(a => a.contrato_id === cid).reduce((s, a) => s + (Number(a.total) || 0), 0)

  const cantRecibida = itemId =>
    (ingresos_material || []).filter(d => d.item_pedido_id === itemId).reduce((s, d) => s + (Number(d.cantidad) || 0), 0)

  const filtered = proyectos.filter(p => {
    const c = constructoras.find(x => x.id === p.constructora_id)
    return (
      (!search || p.nombre?.toLowerCase().includes(search.toLowerCase()) || c?.nombre?.toLowerCase().includes(search.toLowerCase())) &&
      (!filtConst || p.constructora_id === filtConst) &&
      (!filtEst   || p.estado === filtEst)
    )
  }).sort((a, b) => a.nombre.localeCompare(b.nombre))

  function openNew()   { setForm(emptyForm); setEditId(null); setModal(true) }
  function openEdit(p) { setForm({ ...p }); setEditId(p.id); setModal(true) }

  async function guardar() {
    if (!form.nombre)          { toast('El nombre es obligatorio', 'err'); return }
    if (!form.constructora_id) { toast('Selecciona la constructora', 'err'); return }
    try {
      if (editId) {
        const { data, error } = await supabase.from('proyectos').update(form).eq('id', editId).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, proyectos: d.proyectos.map(p => p.id === editId ? data : p) }))
        if (proySel?.id === editId) setProySel(data)
        toast('Proyecto actualizado', 'ok')
      } else {
        const { data, error } = await supabase.from('proyectos').insert(form).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, proyectos: [...d.proyectos, data] }))
        toast('Proyecto creado', 'ok')
      }
      setModal(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  async function eliminar() {
    try {
      const { error } = await supabase.from('proyectos').delete().eq('id', delId)
      if (error) throw error
      setDbData(d => ({ ...d, proyectos: d.proyectos.filter(p => p.id !== delId) }))
      toast('Proyecto eliminado', 'ok')
      setDelId(null)
      setVista('lista')
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  // ── Dashboard data ────────────────────────────────────────
  const contrProy  = contratos.filter(c => c.proyecto_id === proySel?.id)
  const pedProy    = pedidos.filter(p => p.proyecto_id === proySel?.id)
  const adProy     = adicionales.filter(a => a.proyecto_id === proySel?.id)
  const constru    = constructoras.find(c => c.id === proySel?.constructora_id)
  const estSel     = ESTADOS[proySel?.estado] || ESTADOS.activo
  const totalContratos = contrProy.reduce((s, c) => s + (Number(c.valor_total) || 0), 0)
  const totalFact      = contrProy.reduce((s, c) => s + totalFacturado(c.id), 0)
  const pctFact        = totalContratos > 0 ? (totalFact / totalContratos) * 100 : 0
  const itemsPed       = pedProy.flatMap(p => items_pedido.filter(i => i.pedido_id === p.id))
  // Materiales en plata (con IVA): lo comprado y lo que ya llegó a la obra
  const valorComprado  = itemsPed.reduce((s, i) => s + Number(i.cantidad_pedida || 0) * Number(i.vr_unitario || 0), 0) * 1.19
  const valorRecibido  = itemsPed.reduce((s, i) => s + Math.min(cantRecibida(i.id), Number(i.cantidad_pedida || 0)) * Number(i.vr_unitario || 0), 0) * 1.19
  const pctPed         = valorComprado > 0 ? (valorRecibido / valorComprado) * 100 : 0
  const adPend         = adProy.filter(a => a.estado === 'pendiente').length
  const adCobrar       = adProy.filter(a => a.cobrar_a_obra && !a.aprobado).length

  // ── Render ────────────────────────────────────────────────
  return (
    <div>

      {/* ── DASHBOARD ── */}
      {vista === 'dashboard' && proySel && (
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 24 }}>
            <Btn onClick={() => setVista('lista')}>← Proyectos</Btn>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{proySel.nombre}</h1>
                <Badge color={estSel.color}>{estSel.label}</Badge>
              </div>
              <div style={{ fontSize: 13, color: C.g5, marginTop: 4 }}>
                🏢 {constru?.nombre}
                {proySel.fecha_inicio && ` · Inicio: ${fmtDate(proySel.fecha_inicio)}`}
                {proySel.fecha_fin    && ` · Entrega: ${fmtDate(proySel.fecha_fin)}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={() => openEdit(proySel)}>Editar</Btn>
              <Btn variant="danger" onClick={() => setDelId(proySel.id)}>Eliminar</Btn>
            </div>
          </div>

          {(() => {
            const torres = obrasDeProy(proySel).map(id => obras.find(o => o.id === id)).filter(Boolean)
            return (
              <div style={{ ...card, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: 11, color: C.g5, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {torres.length > 1 ? 'Torres en Gestión de Obras' : 'Obra en Gestión de Obras'}
                  </span>
                  <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {torres.length ? torres.map(t => <span key={t.id}>🏗️ {t.nombre}</span>) : 'Sin vincular'}
                  </div>
                  {!torres.length && <div style={{ fontSize: 12, color: C.g5 }}>Sin vincular no se puede leer el avance de instalación ni el costo de la obra.</div>}
                </div>
                <Btn onClick={abrirTorres}>{torres.length ? 'Torres / obras' : 'Vincular obra'}</Btn>
              </div>
            )
          })()}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {puede('contratos')   && <Btn size="sm" onClick={() => ir('contratos', {})}>📄 Contratos</Btn>}
            {puede('pedidos')     && <Btn size="sm" onClick={() => ir('pedidos', {})}>📦 Pedidos</Btn>}
            {puede('produccion')  && <Btn size="sm" onClick={() => ir('produccion', {})}>🔨 Producción</Btn>}
            {puede('despachos')   && <Btn size="sm" onClick={() => ir('despachos', {})}>🚚 Despachos</Btn>}
            {puede('facturacion') && <Btn size="sm" onClick={() => ir('facturacion', {})}>💰 Facturación</Btn>}
          </div>

          {verFinanzas && verContr && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${verFact ? 4 : 2},1fr)`, gap: 12, marginBottom: 24 }}>
              <Stat label="Total contratos"  value={fmt(totalContratos)} />
              {verFact && <Stat label="Facturado"    value={fmt(totalFact)} color={C.gnD} sub={`${Math.round(pctFact)}% del total`} />}
              {verFact && <Stat label="Por facturar" value={fmt(totalContratos - totalFact)} color={C.am} />}
              <Stat label="Adicionales"      value={adPend + adCobrar} color={adPend > 0 ? C.rd : C.gnD}
                sub={adPend > 0 ? `${adPend} pendiente(s)` : 'Al día'} />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {verFinanzas && verContr && (
              <div>
                <h3 style={h3}>📄 Contratos {linkMod('contratos', 'Ver módulo')}</h3>
                {contrProy.length === 0 ? (
                  <div style={{ ...card, textAlign: 'center', color: C.g4, padding: '1.5rem', fontSize: 13 }}>Sin contratos</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {contrProy.map(c => {
                      const pct = totalContratos > 0 ? (totalFacturado(c.id) / Number(c.valor_total || 1)) * 100 : 0
                      const tipo = c.tipo === 'suministro' ? '📦' : c.tipo === 'instalacion' ? '🔧' : '📋'
                      const label = c.tipo === 'suministro' ? 'Suministro' : c.tipo === 'instalacion' ? 'Instalación' : 'Todo Costo'
                      return (
                        <div key={c.id} style={{ ...card, padding: '12px 16px', ...(puede('contratos') ? { cursor: 'pointer' } : {}) }}
                          {...clic('contratos')} onClick={() => puede('contratos') && ir('contratos', { contratoId: c.id })}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700 }}>{tipo} {label}{c.numero ? ` #${c.numero}` : ''}<Flecha k="contratos" /></span>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{fmt(c.valor_total)}</div>
                              {verFact && <div style={{ fontSize: 11, color: C.gnD }}>{fmt(totalFacturado(c.id))} facturado</div>}
                            </div>
                          </div>
                          {verFact && <Progress value={pct} />}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div>
              <h3 style={h3}>📦 Materiales {linkMod('pedidos', 'Ver pedidos')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ ...card, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Total pedido</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{verFinanzas ? fmt(valorComprado) : '—'}</div>
                  <div style={{ fontSize: 10, color: C.g4 }}>con IVA</div>
                </div>
                <div style={{ ...card, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>Llegado a planta</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.gnD }}>{verFinanzas ? fmt(valorRecibido) : '—'}</div>
                  <div style={{ fontSize: 10, color: C.g4 }}>recibido</div>
                </div>
                <div style={{ ...card, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: C.g4, marginBottom: 4 }}>% llegado</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: pctPed >= 100 ? C.gnD : C.am }}>{Math.round(pctPed)}%</div>
                  <div style={{ fontSize: 10, color: C.g4 }}>del total pedido</div>
                </div>
              </div>
              <Progress value={pctPed} />
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pedProy.map(p => {
                  const its = items_pedido.filter(i => i.pedido_id === p.id)
                  const val2 = its.reduce((s,i) => s + Number(i.cantidad_pedida||0)*Number(i.vr_unitario||0), 0)
                  const rec2 = its.reduce((s,i) => s + Math.min(cantRecibida(i.id), Number(i.cantidad_pedida||0))*Number(i.vr_unitario||0), 0)
                  const pct2 = val2 > 0 ? (rec2/val2)*100 : 0
                  return (
                    <div key={p.id} style={{ ...card, padding: '10px 14px', ...(puede('pedidos') ? { cursor: 'pointer' } : {}) }}
                      {...clic('pedidos')} onClick={() => puede('pedidos') && ir('pedidos', { pedidoId: p.id })}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{p.proveedor || 'Sin proveedor'}</span>
                          {p.numero && <span style={{ fontSize: 12, color: C.g4, marginLeft: 8 }}>#{p.numero}</span>}
                          <Flecha k="pedidos" />
                        </div>
                        {verFinanzas && (
                          <div style={{ fontSize: 13, fontWeight: 600, color: C.gnD }}>
                            {fmt(its.reduce((s,i) => s + Number(i.cantidad_pedida||0)*Number(i.vr_unitario||0),0) * 1.19)}
                          </div>
                        )}
                      </div>
                      <Progress value={pct2} />
                      <div style={{ fontSize: 11, color: C.g5, marginTop: 4 }}>
                        {Math.round(pct2)}% llegado a planta{verFinanzas ? ` · ${fmt(rec2 * 1.19)} de ${fmt(val2 * 1.19)}` : ''}
                      </div>
                    </div>
                  )
                })}
                {pedProy.length === 0 && <div style={{ ...card, textAlign: 'center', color: C.g4, padding: '1.5rem', fontSize: 13 }}>Sin pedidos</div>}
              </div>
            </div>

            {verFinanzas && adProy.length > 0 && (
              <div>
                <h3 style={h3}>➕ Adicionales</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {adProy.slice(0, 5).map(a => (
                    <div key={a.id} style={{ ...card, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{a.descripcion}</div>
                        <div style={{ fontSize: 11, color: C.g5 }}>
                          {a.origen === 'obra' ? '🏗️ Por obra' : '🔧 Por instalador'}
                          {a.cobrar_a_obra ? ' · Por cobrar' : ' · Interno'}
                        </div>
                      </div>
                      <Badge color={a.estado === 'aprobado' ? 'green' : a.estado === 'rechazado' ? 'red' : 'amber'}>{a.estado}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Producción: lotes por contrato ── */}
            {(() => {
              const contrProd = contrProy.filter(c => c.tipo === 'suministro' || c.tipo === 'todo_costo')
              if (contrProd.length === 0) return null
              return (
                <div>
                  <h3 style={h3}>🔨 Producción {linkMod('produccion', 'Ver módulo')}</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {contrProd.map(c => {
                      const lotes = lotes_produccion.filter(l => l.contrato_id === c.id)
                      const comp  = lotes.filter(l => l.estado === 'completado').length
                      const plan  = items_lote.filter(i => lotes.some(l => l.id === i.lote_id)).reduce((s, i) => s + Number(i.cantidad || 0), 0)
                      const desp  = remisiones.filter(r => r.contrato_id === c.id)
                        .flatMap(r => items_remision.filter(i => i.remision_id === r.id))
                        .reduce((s, i) => s + Number(i.cantidad || 0), 0)
                      const pct   = plan > 0 ? Math.min(100, (desp / plan) * 100) : 0
                      return (
                        <div key={c.id} style={{ ...card, padding: '10px 14px', ...(puede('produccion') ? { cursor: 'pointer' } : {}) }}
                          {...clic('produccion')} onClick={() => puede('produccion') && ir('produccion', { contratoId: c.id })}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>
                              {c.tipo === 'suministro' ? '📦 Suministro' : '📋 Todo Costo'}{c.numero ? ` #${c.numero}` : ''}<Flecha k="produccion" />
                            </span>
                            {lotes.length > 0
                              ? <Badge color={comp === lotes.length ? 'green' : 'amber'}>{comp}/{lotes.length} lotes</Badge>
                              : <Badge color="gray">Sin lotes</Badge>}
                          </div>
                          {lotes.length > 0 && <>
                            <Progress value={pct} />
                            <div style={{ fontSize: 11, color: C.g5, marginTop: 4 }}>{Math.round(pct)}% despachado</div>
                          </>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* ── Despachos: últimas remisiones ── */}
            {(() => {
              const rems = remisiones.filter(r => contrProy.some(c => c.id === r.contrato_id))
                .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
              if (rems.length === 0) return null
              return (
                <div>
                  <h3 style={h3}>🚚 Últimas remisiones {linkMod('despachos', `Ver las ${rems.length}`)}</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rems.slice(0, 5).map(r => {
                      const tot  = items_remision.filter(i => i.remision_id === r.id).reduce((s, i) => s + Number(i.cantidad || 0), 0)
                      const lote = lotes_produccion.find(l => l.id === r.lote_id)
                      return (
                        <div key={r.id} style={{ ...card, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...(puede('despachos') ? { cursor: 'pointer' } : {}) }}
                          {...clic('despachos')} onClick={() => puede('despachos') && ir('despachos', { remisionId: r.id })}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>REM {r.numero || '—'}<Flecha k="despachos" /></div>
                            <div style={{ fontSize: 11, color: C.g5 }}>
                              {r.fecha ? fmtDate(r.fecha) : 'Sin fecha'}{lote ? ` · ${lote.nombre}` : ''}
                            </div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{tot.toLocaleString('es-CO')} und</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {verFact && (() => {
              const ci = costoInstalacion(proySel)
              if (!ci || (ci.valorInstalado === 0 && ci.pagado === 0)) return null
              const pctM = ci.valorInstalado > 0 ? ci.margen / ci.valorInstalado * 100 : 0
              return (
                <div>
                  <h3 style={h3}>🔧 Costo de instalación</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 10 }}>
                    <Stat label="Vale lo instalado" value={fmt(ci.valorInstalado)} sub="a precio de contrato" />
                    <Stat label="Pagado a la gente" value={fmt(ci.pagado)} color={C.am} />
                    <Stat label="Margen" value={fmt(ci.margen)} color={ci.margen >= 0 ? C.gnD : C.rd} sub={`${Math.round(pctM)}% de lo instalado`} />
                  </div>
                  {(() => {
                    const ad = adicionalesPorResponsable(proySel)
                    if (!ad.santalucia && !ad.obra && !ad.sin) return null
                    return (
                      <div style={{ ...card, padding: '8px 14px', marginBottom: 6, fontSize: 13, cursor: puede('adicionales') ? 'pointer' : 'default' }}
                        onClick={() => puede('adicionales') && ir('adicionales', {})}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>🪵 Adicionales asumidos por Santa Lucía {ad.nSL ? `(${ad.nSL})` : ''}</span>
                          <strong style={{ color: C.rd }}>{fmt(ad.santalucia)}</strong>
                        </div>
                        <div style={{ fontSize: 11, color: C.g5, marginTop: 2 }}>
                          Adicionales de la obra pagados al instalador: {fmt(ad.obra)}{ad.sin ? ` · sin clasificar: ${fmt(ad.sin)}` : ''}
                        </div>
                      </div>
                    )
                  })()}
                  {ci.retTot > 0 && (
                    <div style={{ ...card, padding: '8px 14px', marginBottom: 6, fontSize: 13, display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
                      onClick={() => setRetDet(ci)}>
                      <span>🧾 Retenido 10% en esta obra <span style={{ color: C.bl, fontSize: 12 }}>· ver por instalador ›</span></span>
                      <strong style={{ color: C.rd }}>{fmt(ci.retTot)}</strong>
                    </div>
                  )}
                  {ci.diasTot > 0 && (
                    <div style={{ ...card, padding: '8px 14px', marginBottom: 10, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                      <span>📅 Días laborados pagados en esta obra</span>
                      <strong>{ci.diasTot} día(s) · {fmt(ci.diasVal)}</strong>
                    </div>
                  )}
                  <div style={{ display: 'grid', gap: 6 }}>
                    {ci.cortes.map(c => (
                      <div key={c.corte} style={{ ...card, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                        onClick={() => setCorteDet(c)}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.corte} ›</div>
                          <div style={{ fontSize: 11, color: C.g5 }}>
                            {c.personas.length} persona(s) · instalación {fmt(c.inst)}{c.det ? ` · detallado ${fmt(c.det)}` : ''}{c.adic ? ` · adicionales ${fmt(c.adic)}` : ''}{c.dias ? ` · ${c.dias} día(s) laborados ${fmt(c.dia)}` : ''}{c.ret ? ` · retenido ${fmt(c.ret)}` : ''}
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(c.inst + c.det + c.adic + c.dia)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {verFact && (
              <div>
                <h3 style={h3}>🧾 Últimas actas {linkMod('facturacion', 'Ver facturación')}</h3>
                {(() => {
                  const actas = actas_facturacion.filter(a => contrProy.some(c => c.id === a.contrato_id))
                    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5)
                  return actas.length === 0 ? (
                    <div style={{ ...card, textAlign: 'center', color: C.g4, padding: '1.5rem', fontSize: 13 }}>Sin actas</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {actas.map(a => {
                        const c = contrProy.find(x => x.id === a.contrato_id)
                        return (
                          <div key={a.id} style={{ ...card, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...(puede('facturacion') ? { cursor: 'pointer' } : {}) }}
                            {...clic('facturacion')} onClick={() => puede('facturacion') && ir('facturacion', { actaId: a.id })}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>
                                {c?.tipo === 'suministro' ? '📦' : '🔧'} Acta {a.numero_acta || '—'}<Flecha k="facturacion" />
                              </div>
                              <div style={{ fontSize: 11, color: C.g5 }}>{fmtDate(a.fecha)}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: C.gnD }}>{fmt(a.total)}</div>
                              <Badge color={a.estado === 'pagada' ? 'green' : a.estado === 'facturada' ? 'blue' : 'amber'}>{a.estado}</Badge>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LISTA ── */}
      {vista === 'lista' && (
        <div>
          <SectionHeader title="Proyectos">
            <Btn variant="primary" onClick={openNew}>+ Nuevo proyecto</Btn>
          </SectionHeader>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <input placeholder="Buscar proyecto…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, outline: 'none', width: 220 }} />
            <select value={filtConst} onChange={e => setFiltConst(e.target.value)}
              style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
              <option value="">Todas las constructoras</option>
              {constructoras.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select value={filtEst} onChange={e => setFiltEst(e.target.value)}
              style={{ padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, background: C.wh }}>
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            {Object.entries(ESTADOS).map(([k,v]) => (
              <div key={k} style={{ ...card, padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <Badge color={v.color}>{v.label}</Badge>
                <span style={{ fontWeight: 700, fontSize: 18 }}>{proyectos.filter(p => p.estado === k).length}</span>
              </div>
            ))}
          </div>

          {filtered.length === 0 ? (
            <Empty icon="🏗️" title="Sin proyectos" desc="Crea el primer proyecto."
              action={<Btn variant="primary" onClick={openNew}>+ Nuevo proyecto</Btn>} />
          ) : (
            <div>
              {constructoras.map(constr => {
                const pList = filtered.filter(p => p.constructora_id === constr.id)
                if (!pList.length) return null
                return (
                  <div key={constr.id} style={{ marginBottom: 28 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${C.g2}` }}>
                      <span style={{ fontSize: 18 }}>🏢</span>
                      <span style={{ fontWeight: 800, fontSize: 16 }}>{constr.nombre}</span>
                      <span style={{ fontSize: 12, color: C.g5 }}>{pList.length} proyecto(s)</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                      {pList.map(p => {
                        const est = ESTADOS[p.estado] || ESTADOS.activo
                        const cP = contratos.filter(c => c.proyecto_id === p.id)
                        const tF = cP.reduce((s, c) => s + totalFacturado(c.id), 0)
                        const tC = cP.reduce((s, c) => s + (Number(c.valor_total)||0), 0)
                        const pct = tC > 0 ? (tF/tC)*100 : 0
                        return (
                          <div key={p.id} style={{
                            ...card, cursor: 'pointer',
                            borderLeft: `4px solid ${p.estado==='activo'?C.or:p.estado==='pausado'?C.am:C.g3}`,
                          }}
                            onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.1)'}
                            onMouseLeave={e => e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.06)'}
                            onClick={() => { setProySel(p); setVista('dashboard') }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                              <div style={{ fontWeight: 700, fontSize: 15 }}>{p.nombre}</div>
                              <Badge color={est.color}>{est.label}</Badge>
                            </div>
                            <div style={{ fontSize: 12, color: C.g5, display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                              <span>📄 {cP.length} contrato(s)</span>
                              <span>📦 {pedidos.filter(x => x.proyecto_id === p.id).length} pedido(s)</span>
                              {p.fecha_inicio && <span>📅 {fmtDate(p.fecha_inicio)}</span>}
                            </div>
                            {verFinanzas && verContr && tC > 0 && (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                  <span style={{ color: C.g5 }}>{fmt(tC)}</span>
                                  {verFact && <span style={{ color: C.gnD, fontWeight: 600 }}>{Math.round(pct)}% facturado</span>}
                                </div>
                                {verFact && <Progress value={pct} />}
                              </div>
                            )}
                            {p.notas && <div style={{ fontSize: 11, color: C.g4, marginTop: 8, fontStyle: 'italic' }}>{p.notas}</div>}
                            <div style={{ display: 'flex', gap: 6, marginTop: 10 }} onClick={e => e.stopPropagation()}>
                              <Btn size="sm" onClick={() => openEdit(p)}>Editar</Btn>
                              <Btn size="sm" variant="danger" onClick={() => setDelId(p.id)}>Eliminar</Btn>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {filtered.filter(p => !p.constructora_id).map(p => (
                <div key={p.id} style={{ ...card, cursor: 'pointer', marginBottom: 8 }}
                  onClick={() => { setProySel(p); setVista('dashboard') }}>
                  <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODALES (siempre disponibles) ── */}
      {modalObra && (
        <Modal title="Torres del proyecto en Gestión de Obras" onClose={() => setModalObra(false)} wide>
          <p style={{ fontSize: 13, color: C.g5, marginBottom: 12 }}>
            Un contrato puede ejecutarse en varias torres. Cada torre es una obra aparte en Gestión de Obras,
            con su propia nomenclatura, y el ERP suma todas para el contrato.
          </p>
          <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
            {torresTmp.length === 0 && <div style={{ fontSize: 13, color: C.g4 }}>Sin torres vinculadas.</div>}
            {torresTmp.map((id, i) => (
              <div key={id} style={{ ...card, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>🏗️ {obras.find(o => o.id === id)?.nombre || id}</span>
                <span onClick={() => setTorresTmp(t => t.filter(x => x !== id))} title="Quitar del proyecto"
                  style={{ cursor: 'pointer', color: C.rd, fontWeight: 700 }}>✕</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <Sel label="Agregar una obra que ya existe" value={obraForm} onChange={e => setObraForm(e.target.value)}>
                <option value="">— Seleccionar —</option>
                {obras.filter(o => !torresTmp.includes(o.id)).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Sel>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Btn onClick={() => { if (obraForm) { setTorresTmp(t => [...t, obraForm]); setObraForm('') } }} disabled={!obraForm}>+ Agregar</Btn>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.g2}`, paddingTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>¿La torre todavía no existe en Gestión?</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <Inp label="Nombre de la torre" value={nombreTorre} onChange={e => setNombreTorre(e.target.value)} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <Btn onClick={crearTorreEnGestion} disabled={savingObra}>+ Crear en Gestión</Btn>
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.g5 }}>Se crea vacía; los pisos, apartamentos y tipologías se arman en Gestión de Obras.</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setModalObra(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={() => guardarTorres(torresTmp)} disabled={savingObra}>
              {savingObra ? 'Guardando…' : 'Guardar'}
            </Btn>
          </div>
        </Modal>
      )}

      {retDet && (
        <Modal title={`Retenidos por instalador — ${retDet.obra?.nombre || ''}`} onClose={() => setRetDet(null)} wide>
          <div style={{ ...card, padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.g1 }}>
                  {['INSTALADOR', 'CÉDULA', 'CORTE', 'CAUSADO EN LA OBRA', 'RETENIDO 10%'].map((h, i) => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: i < 3 ? 'left' : 'right', fontSize: 10, fontWeight: 700, color: C.g5, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {retDet.retenidos.flatMap((p, i) => [
                  ...p.cortes.filter(c => c.ret > 0).map((c, j) => (
                    <tr key={`${i}-${j}`} style={{ borderTop: `1px solid ${C.g1}` }}>
                      <td style={{ padding: '6px 10px', fontWeight: 600 }}>{j === 0 ? p.nombre : ''}</td>
                      <td style={{ padding: '6px 10px', color: C.g5 }}>{j === 0 ? (p.cedula || '—') : ''}</td>
                      <td style={{ padding: '6px 10px' }}>{c.corte}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmt(c.causado)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: C.rd }}>{fmt(c.ret)}</td>
                    </tr>
                  )),
                  <tr key={`t${i}`} style={{ background: C.g0, borderTop: `1px solid ${C.g2}` }}>
                    <td colSpan={3} style={{ padding: '6px 10px', fontWeight: 700, textAlign: 'right' }}>Total {String(p.nombre).split(' ')[0]}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>{fmt(p.causado)}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: C.rd }}>{fmt(p.ret)}</td>
                  </tr>,
                ])}
                <tr style={{ background: '#2B313A' }}>
                  <td colSpan={3} style={{ padding: '8px 10px', color: 'white', fontWeight: 700 }}>TOTAL RETENIDO EN LA OBRA</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: 'white', fontWeight: 700 }}>{fmt(retDet.retenidos.reduce((x, p) => x + p.causado, 0))}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#FCA5A5', fontWeight: 800 }}>{fmt(retDet.retTot)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: C.g5, marginTop: 12 }}>
            El retenido de cada corte es el 10% de lo que la persona causó en esta obra (instalación, detallado y adicionales).
            Si en el mismo corte trabajó en otras obras, lo retenido allá sale en el reporte de esas obras.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <Btn variant="success" onClick={() => exportarRetenidos(retDet)}>📊 Descargar Excel</Btn>
            <Btn onClick={() => setRetDet(null)}>Cerrar</Btn>
          </div>
        </Modal>
      )}

      {corteDet && (
        <Modal title={`Pagos del corte ${corteDet.corte}`} onClose={() => setCorteDet(null)} wide>
          <div style={{ ...card, padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.g1 }}>
                  {['PERSONA', 'INSTALACIÓN', 'DETALLADO', 'ADICIONALES', 'RETENIDO 10%', 'DÍAS LAB.', 'NETO OBRA', 'PASAJES *', 'BONIF. *', 'TOTAL CORTE *'].map((h, i) => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: 10, fontWeight: 700, color: C.g5, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corteDet.personas.map((p, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.g1}` }}>
                    <td style={{ padding: '7px 10px', fontWeight: 600 }}>
                      {p.nombre}
                      {!p.soloEstaObra && <span style={{ fontSize: 10, color: C.or, marginLeft: 6 }}>trabajó en más obras</span>}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmt(p.inst)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>{p.det ? fmt(p.det) : '—'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>{p.adic ? fmt(p.adic) : '—'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: C.rd }}>{fmt(p.ret)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>{p.dias ? `${p.dias} · ${fmt(p.dia)}` : '—'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>{fmt(p.neto)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: C.g5 }}>{p.pas ? fmt(p.pas) : '—'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: C.g5 }}>{p.bon ? fmt(p.bon) : '—'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: C.g5 }}>{fmt(p.totalCorte)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: C.g5, marginTop: 12 }}>
            Instalación, detallado, adicionales, días y el retenido (10% de lo causado aquí) son solo de esta obra,
            y el neto obra es lo que le correspondió por ella. Las columnas con * son del corte completo de esa persona:
            si trabajó en varias obras, incluyen las demás.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Btn onClick={() => setCorteDet(null)}>Cerrar</Btn>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title={editId ? 'Editar proyecto' : 'Nuevo proyecto'} onClose={() => setModal(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Inp label="Nombre *" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Verde Silvestre…" />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <Sel label="Constructora *" value={form.constructora_id} onChange={e => setForm(f => ({ ...f, constructora_id: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                {constructoras.filter(c => c.activa).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </Sel>
            </div>
            <Sel label="Estado" value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
              {Object.entries(ESTADOS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </Sel>
            <div />
            <Inp label="Fecha inicio" type="date" value={form.fecha_inicio||''} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
            <Inp label="Fecha entrega" type="date" value={form.fecha_fin||''} onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value }))} />
            <div style={{ gridColumn: '1/-1' }}>
              <Txt label="Notas" value={form.notas||''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <Btn onClick={() => setModal(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardar}>{editId ? 'Guardar' : 'Crear proyecto'}</Btn>
          </div>
        </Modal>
      )}

      {delId && (
        <Modal title="Eliminar proyecto" onClose={() => setDelId(null)}>
          <p style={{ fontSize: 14, marginBottom: 8 }}>¿Eliminar <strong>{proyectos.find(p => p.id === delId)?.nombre}</strong>?</p>
          <p style={{ fontSize: 13, color: C.rd, marginBottom: 20 }}>Se eliminarán todos los contratos, pedidos y actas asociadas.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Btn onClick={() => setDelId(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={eliminar}>Sí, eliminar</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
