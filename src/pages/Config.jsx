import { useState, useEffect } from 'react'
import { C, Btn, Inp, Empty, SectionHeader, card } from '../components/UI.jsx'
import { supabase } from '../lib/supabase.js'

// Datos de la empresa y tasas del sistema.
// Antes estaban escritos a mano en Adicionales, Despachos, Facturación,
// Pedidos, Proyectos e impuestos.js — cambiar el NIT obligaba a tocar código.
// Ahora viven en una sola fila de la tabla `configuracion`.
//
// OJO: el IVA y la utilidad se leen una sola vez al cargar la app (ver setTasas
// en App.jsx). Por eso, al guardar un cambio de tasas, se recarga la página:
// si no, las pantallas que ya estaban abiertas seguirían calculando con la vieja.

const CAMPOS = [
  { k: 'empresa',   l: 'Razón social',  ph: 'Santa Lucía Muebles y Pisos S.A.S.' },
  { k: 'nit',       l: 'NIT',           ph: '900.000.000-0' },
  { k: 'telefono',  l: 'Teléfono',      ph: '300.000.00.00' },
  { k: 'email',     l: 'Correo',        ph: 'correo@empresa.com' },
  { k: 'direccion', l: 'Dirección',     ph: 'Calle 00 # 00-00' },
  { k: 'ciudad',    l: 'Ciudad',        ph: 'Medellín' },
]

const TASAS = [
  { k: 'iva_pct',      l: 'IVA (%)',
    ayuda: 'En suministro va sobre el subtotal; en instalación, sobre la utilidad.' },
  { k: 'retenido_pct', l: 'Retenido al instalador (%)',
    ayuda: 'Lo que se le retiene a cada persona de lo causado en la obra.' },
  { k: 'utilidad_pct', l: 'Utilidad por defecto (%)',
    ayuda: 'Solo para contratos nuevos. Cada contrato puede tener la suya.' },
]

export default function Config({ dbData, user, toast, reload }) {
  const cfg = (dbData.configuracion || [])[0]
  const [form, setForm]   = useState(cfg || {})
  const [saving, setSaving] = useState(false)

  // Se resincroniza con lo que hay en la base cada vez que la fila cambia.
  // Antes dependía solo del id (que siempre es 'app'), así que la pantalla se
  // quedaba mostrando lo tecleado aunque no se hubiera guardado nada.
  useEffect(() => { if (cfg) setForm(cfg) }, [cfg?.actualizado_en, cfg?.id])

  if (!cfg) {
    return (
      <div>
        <SectionHeader title="⚙️ Configuración" />
        <Empty icon="⚙️" title="Falta crear la tabla de configuración"
          desc="Corre el script config_y_pin.sql en Supabase y vuelve a entrar." />
      </div>
    )
  }

  const puede = user.rol === 'superadmin'
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  // ¿Cambió alguna tasa? De eso depende si hay que recargar al guardar.
  const tasasCambiaron = TASAS.some(t => num(form[t.k]) !== num(cfg[t.k]))

  async function guardar() {
    for (const t of TASAS) {
      const v = num(form[t.k])
      if (v < 0 || v > 100) { toast(`${t.l}: debe estar entre 0 y 100`, 'err'); return }
    }
    setSaving(true)
    // Va por función de la base a propósito: un UPDATE normal, cuando la regla
    // de permisos no se cumple, no falla — no cambia nada y no avisa. La función
    // devuelve la fila guardada, o levanta el error diciendo qué pasó.
    const { data, error } = await supabase.rpc('guardar_configuracion', {
      p: {
        empresa: form.empresa || '', nit: form.nit || '',
        telefono: form.telefono || '', email: form.email || '',
        direccion: form.direccion || '', ciudad: form.ciudad || '',
        iva_pct: num(form.iva_pct), retenido_pct: num(form.retenido_pct),
        utilidad_pct: num(form.utilidad_pct),
      },
    })
    setSaving(false)
    if (error) { toast('No se pudo guardar: ' + error.message, 'err'); return }
    if (!data) { toast('La base no devolvió la fila guardada. Vuelve a intentar.', 'err'); return }
    if (tasasCambiaron) {
      toast('Guardado. Recargando para aplicar las tasas…', 'ok')
      setTimeout(() => window.location.reload(), 900)
    } else {
      toast('Configuración guardada', 'ok')
      reload?.()
    }
  }

  const et = { fontSize: 11, color: C.g5, marginTop: -8, marginBottom: 14, lineHeight: 1.4 }

  return (
    <div>
      <SectionHeader title="⚙️ Configuración" />

      {!puede && (
        <div style={{ ...card, borderLeft: `4px solid ${C.am}`, marginBottom: 18, fontSize: 13, color: C.g5 }}>
          Solo gerencia puede cambiar estos datos. Acá los ves como están.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px,1fr))', gap: 18, alignItems: 'start' }}>

        <div style={{ ...card, borderLeft: `4px solid ${C.or}` }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Datos de la empresa</div>
          <div style={{ fontSize: 12, color: C.g5, marginBottom: 16 }}>
            Es lo que sale en el pie de las remisiones, los informes de adicionales y los cobros.
          </div>
          {CAMPOS.map(c => (
            <Inp key={c.k} label={c.l} placeholder={c.ph} disabled={!puede}
              value={form[c.k] || ''} onChange={e => setForm(f => ({ ...f, [c.k]: e.target.value }))} />
          ))}
        </div>

        <div style={{ ...card, borderLeft: `4px solid ${C.bl}` }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Tasas</div>
          <div style={{ fontSize: 12, color: C.g5, marginBottom: 16 }}>
            Cambiarlas afecta los cálculos de aquí en adelante. Lo ya facturado queda como quedó.
          </div>
          {TASAS.map(t => (
            <div key={t.k}>
              <Inp label={t.l} type="number" min="0" max="100" step="0.01" disabled={!puede}
                value={form[t.k] ?? ''} onChange={e => setForm(f => ({ ...f, [t.k]: e.target.value }))} />
              <div style={et}>{t.ayuda}</div>
            </div>
          ))}
          {tasasCambiaron && puede && (
            <div style={{ fontSize: 12, color: C.orD, background: C.orL, border: `1px solid ${C.orM}`,
              borderRadius: 8, padding: '9px 12px', marginTop: 4 }}>
              Cambiaste una tasa. Al guardar, la página se recarga sola para que todas las
              pantallas queden con el valor nuevo.
            </div>
          )}
        </div>
      </div>

      {puede && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <Btn onClick={() => setForm(cfg)}>Deshacer</Btn>
          <Btn variant="primary" disabled={saving} onClick={guardar}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Btn>
        </div>
      )}

      {cfg.actualizado_en && (
        <div style={{ fontSize: 11, color: C.g4, textAlign: 'right', marginTop: 10 }}>
          Último cambio: {new Date(cfg.actualizado_en).toLocaleString('es-CO')}
          {cfg.actualizado_por ? ` · ${cfg.actualizado_por}` : ''}
        </div>
      )}
    </div>
  )
}
