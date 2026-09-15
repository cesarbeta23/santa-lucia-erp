-- ═══════════════════════════════════════════════════════════
-- SANTA LUCÍA ERP — Schema de tablas nuevas
-- Ejecutar en Supabase SQL Editor
-- Las tablas existentes (usuarios, elementos, obras, liquidaciones)
-- NO se modifican — solo se extienden con referencias.
-- ═══════════════════════════════════════════════════════════

-- ── 1. CONSTRUCTORAS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS constructoras (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  nit         TEXT,
  contacto    TEXT,
  telefono    TEXT,
  email       TEXT,
  ciudad      TEXT,
  activa      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 2. PROYECTOS (vincula obra existente con constructora) ──
-- Una obra puede tener múltiples contratos (sum + inst o todo costo)
CREATE TABLE IF NOT EXISTS proyectos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         TEXT NOT NULL,          -- id de tabla "obras" existente
  constructora_id UUID REFERENCES constructoras(id),
  nombre          TEXT NOT NULL,
  estado          TEXT DEFAULT 'activo',  -- activo | terminado | pausado
  fecha_inicio    DATE,
  fecha_fin       DATE,
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 3. CONTRATOS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contratos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id     UUID REFERENCES proyectos(id) ON DELETE CASCADE,
  numero          TEXT,
  tipo            TEXT NOT NULL,  -- suministro | instalacion | todo_costo
  valor_total     NUMERIC(18,2),
  fecha_inicio    DATE,
  fecha_fin       DATE,
  iva_incluido    BOOLEAN DEFAULT true,
  factor_iva      NUMERIC(6,4) DEFAULT 1.19,  -- 1.19 sum / 1.019 inst
  estado          TEXT DEFAULT 'vigente',      -- vigente | liquidado | cancelado
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 4. ÍTEMS DEL CONTRATO ──────────────────────────────────
CREATE TABLE IF NOT EXISTS items_contrato (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     UUID REFERENCES contratos(id) ON DELETE CASCADE,
  ref             TEXT NOT NULL,          -- ej: PT-070-BANO, G-01, ZOC
  descripcion     TEXT NOT NULL,
  unidad          TEXT NOT NULL,          -- und | ml | m2 | apto
  cantidad        NUMERIC(12,4),
  vr_unitario     NUMERIC(14,2),          -- precio sin IVA
  vr_con_iva      NUMERIC(14,2),          -- precio con IVA (del contrato)
  item_num        TEXT,                   -- código ITEM del contrato (ej: 995)
  insumo_num      TEXT,                   -- código INSUMO (ej: 17886)
  orden           INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 5. SUBITEMS DE INSTALACIÓN ─────────────────────────────
-- Desglosa un ítem de contrato en elementos para pagar a instaladores
-- Referencia los elementos de la tabla "elementos" existente
CREATE TABLE IF NOT EXISTS subitems_instalacion (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_contrato_id  UUID REFERENCES items_contrato(id) ON DELETE CASCADE,
  elemento_id       TEXT NOT NULL,    -- id de tabla "elementos" existente
  nombre            TEXT NOT NULL,    -- descripción del subítem
  valor_instalador  NUMERIC(14,2),    -- precio a pagar por este subítem
  activo            BOOLEAN DEFAULT true,  -- moldura opcional por obra
  orden             INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── 6. ACTAS DE INSTALACIÓN INTERNA ───────────────────────
-- Lo que se instaló realmente (independiente de facturación)
CREATE TABLE IF NOT EXISTS actas_instalacion (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id   UUID REFERENCES proyectos(id),
  numero        TEXT,
  fecha         DATE NOT NULL,
  periodo_desde DATE,
  periodo_hasta DATE,
  estado        TEXT DEFAULT 'borrador',  -- borrador | aprobada
  notas         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── 7. ÍTEMS DE ACTA DE INSTALACIÓN ───────────────────────
CREATE TABLE IF NOT EXISTS items_acta_instalacion (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acta_instalacion_id   UUID REFERENCES actas_instalacion(id) ON DELETE CASCADE,
  item_contrato_id      UUID REFERENCES items_contrato(id),
  cantidad              NUMERIC(12,4),
  vr_unitario           NUMERIC(14,2),
  notas                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- ── 8. ACTAS DE FACTURACIÓN (cobros a constructora) ────────
CREATE TABLE IF NOT EXISTS actas_facturacion (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id   UUID REFERENCES contratos(id),
  numero_acta   TEXT,
  fecha         DATE NOT NULL,
  subtotal      NUMERIC(18,2) DEFAULT 0,
  iva           NUMERIC(18,2) DEFAULT 0,
  total         NUMERIC(18,2) DEFAULT 0,
  estado        TEXT DEFAULT 'pendiente',  -- pendiente | facturada | pagada
  numero_factura TEXT,
  fecha_pago    DATE,
  notas         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── 9. ÍTEMS DE ACTA DE FACTURACIÓN ───────────────────────
CREATE TABLE IF NOT EXISTS items_acta_facturacion (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acta_facturacion_id   UUID REFERENCES actas_facturacion(id) ON DELETE CASCADE,
  item_contrato_id      UUID REFERENCES items_contrato(id),
  cantidad              NUMERIC(12,4),
  vr_unitario_sin_iva   NUMERIC(14,2),
  iva                   NUMERIC(14,2) DEFAULT 0,
  vr_total              NUMERIC(14,2),
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- ── 10. PEDIDOS DE MATERIALES ──────────────────────────────
CREATE TABLE IF NOT EXISTS pedidos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id   UUID REFERENCES proyectos(id),
  numero        TEXT,
  proveedor     TEXT,
  fecha         DATE NOT NULL,
  estado        TEXT DEFAULT 'pendiente',  -- pendiente | parcial | completo
  notas         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── 11. ÍTEMS DE PEDIDO ────────────────────────────────────
CREATE TABLE IF NOT EXISTS items_pedido (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id         UUID REFERENCES pedidos(id) ON DELETE CASCADE,
  material          TEXT NOT NULL,  -- láminas | madecantos | herrajes | otro
  descripcion       TEXT,
  unidad            TEXT DEFAULT 'und',
  cantidad_pedida   NUMERIC(12,4),
  cantidad_recibida NUMERIC(12,4) DEFAULT 0,
  vr_unitario       NUMERIC(14,2),
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── 12. DESPACHOS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS despachos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id   UUID REFERENCES proyectos(id),
  numero        TEXT,
  fecha         DATE NOT NULL,
  transportador TEXT,
  notas         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── 13. ÍTEMS DE DESPACHO ──────────────────────────────────
CREATE TABLE IF NOT EXISTS items_despacho (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_id     UUID REFERENCES despachos(id) ON DELETE CASCADE,
  item_pedido_id  UUID REFERENCES items_pedido(id),
  cantidad        NUMERIC(12,4),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 14. ADICIONALES / EXTRAS ───────────────────────────────
CREATE TABLE IF NOT EXISTS adicionales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id   UUID REFERENCES proyectos(id),
  origen        TEXT NOT NULL,    -- instalador | obra
  descripcion   TEXT NOT NULL,
  unidad        TEXT DEFAULT 'und',
  cantidad      NUMERIC(12,4) DEFAULT 1,
  valor         NUMERIC(14,2) DEFAULT 0,
  cobrar_a_obra BOOLEAN DEFAULT false,
  aprobado      BOOLEAN DEFAULT false,
  aprobado_por  TEXT,
  fecha         DATE,
  notas         TEXT,
  estado        TEXT DEFAULT 'pendiente',  -- pendiente | aprobado | rechazado
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── 15. COTIZACIONES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS cotizaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constructora_id UUID REFERENCES constructoras(id),
  numero          TEXT,
  descripcion     TEXT NOT NULL,
  valor_estimado  NUMERIC(18,2),
  fecha           DATE NOT NULL,
  fecha_vence     DATE,
  estado          TEXT DEFAULT 'enviada',  -- borrador | enviada | aprobada | perdida
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── ÍNDICES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_proyectos_obra ON proyectos(obra_id);
CREATE INDEX IF NOT EXISTS idx_contratos_proyecto ON contratos(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_items_contrato ON items_contrato(contrato_id);
CREATE INDEX IF NOT EXISTS idx_actas_fact_contrato ON actas_facturacion(contrato_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_proyecto ON pedidos(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_adicionales_proyecto ON adicionales(proyecto_id);

-- ── RLS (Row Level Security) — habilitar en producción ─────
-- ALTER TABLE constructoras ENABLE ROW LEVEL SECURITY;
-- (configurar políticas según roles de usuarios)
