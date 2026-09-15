import { useState } from 'react'
import { C, Btn, Inp, Modal, Badge, Empty, SectionHeader, card } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

const empty = { nombre: '', nit: '', contacto: '', telefono: '', email: '', ciudad: '', activa: true }

export default function Constructoras({ dbData, setDbData, toast }) {
  const { constructoras = [] } = dbData
  const [modal, setModal]   = useState(false)
  const [form, setForm]     = useState(empty)
  const [editId, setEditId] = useState(null)
  const [delId, setDelId]   = useState(null)
  const [search, setSearch] = useState('')

  const filtered = constructoras.filter(c =>
    c.nombre?.toLowerCase().includes(search.toLowerCase()) ||
    c.ciudad?.toLowerCase().includes(search.toLowerCase())
  )

  function openNew()   { setForm(empty); setEditId(null); setModal(true) }
  function openEdit(c) { setForm({ ...c }); setEditId(c.id); setModal(true) }

  async function guardar() {
    if (!form.nombre) { toast('El nombre es obligatorio', 'err'); return }
    try {
      if (editId) {
        const { data, error } = await supabase.from('constructoras').update(form).eq('id', editId).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, constructoras: d.constructoras.map(c => c.id === editId ? data : c) }))
        toast('Constructora actualizada', 'ok')
      } else {
        const { data, error } = await supabase.from('constructoras').insert(form).select().single()
        if (error) throw error
        setDbData(d => ({ ...d, constructoras: [...d.constructoras, data] }))
        toast('Constructora creada', 'ok')
      }
      setModal(false)
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  async function eliminar() {
    try {
      const { error } = await supabase.from('constructoras').delete().eq('id', delId)
      if (error) throw error
      setDbData(d => ({ ...d, constructoras: d.constructoras.filter(c => c.id !== delId) }))
      toast('Constructora eliminada', 'ok'); setDelId(null)
    } catch (e) { toast('Error: ' + e.message, 'err') }
  }

  return (
    <div>
      <SectionHeader title="Constructoras">
        <Btn variant="primary" onClick={openNew}>+ Nueva constructora</Btn>
      </SectionHeader>

      <div style={{ marginBottom: 16 }}>
        <input placeholder="Buscar por nombre o ciudad…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 320, padding: '8px 12px', border: `1px solid ${C.g2}`, borderRadius: 8, fontSize: 14, outline: 'none' }} />
      </div>

      {filtered.length === 0 ? (
        <Empty icon="🏢" title="Sin constructoras" desc="Agrega las constructoras con las que trabajas."
          action={<Btn variant="primary" onClick={openNew}>+ Nueva constructora</Btn>} />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.map(c => (
            <div key={c.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: C.g1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, border: `1px solid ${C.g2}` }}>🏢</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{c.nombre}</div>
                <div style={{ fontSize: 12, color: C.g5, marginTop: 2, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {c.nit && <span>NIT: {c.nit}</span>}
                  {c.ciudad && <span>📍 {c.ciudad}</span>}
                  {c.telefono && <span>📞 {c.telefono}</span>}
                  {c.email && <span>✉️ {c.email}</span>}
                </div>
                {c.contacto && <div style={{ fontSize: 12, color: C.g4, marginTop: 2 }}>Contacto: {c.contacto}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Badge color={c.activa ? 'green' : 'gray'}>{c.activa ? 'Activa' : 'Inactiva'}</Badge>
                <Btn size="sm" onClick={() => openEdit(c)}>Editar</Btn>
                <Btn size="sm" variant="danger" onClick={() => setDelId(c.id)}>Eliminar</Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={editId ? 'Editar constructora' : 'Nueva constructora'} onClose={() => setModal(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Inp label="Nombre *" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Constructora Capital Medellín S.A.S." />
            </div>
            <Inp label="NIT" value={form.nit || ''} onChange={e => setForm(f => ({ ...f, nit: e.target.value }))} placeholder="000.000.000-0" />
            <Inp label="Ciudad" value={form.ciudad || ''} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} placeholder="Medellín" />
            <Inp label="Contacto" value={form.contacto || ''} onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))} placeholder="Nombre del encargado" />
            <Inp label="Teléfono" value={form.telefono || ''} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
            <div style={{ gridColumn: '1 / -1' }}>
              <Inp label="Correo electrónico" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} type="email" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                <input type="checkbox" checked={form.activa} onChange={e => setForm(f => ({ ...f, activa: e.target.checked }))} />
                Constructora activa
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Btn onClick={() => setModal(false)}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardar}>{editId ? 'Guardar cambios' : 'Crear'}</Btn>
          </div>
        </Modal>
      )}

      {delId && (
        <Modal title="Eliminar constructora" onClose={() => setDelId(null)}>
          <p style={{ fontSize: 14, marginBottom: 20 }}>
            ¿Eliminar <strong>{constructoras.find(c => c.id === delId)?.nombre}</strong>?<br />
            <span style={{ fontSize: 13, color: C.rd }}>Los proyectos y contratos asociados también se eliminarán.</span>
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Btn onClick={() => setDelId(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={eliminar}>Sí, eliminar</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}
