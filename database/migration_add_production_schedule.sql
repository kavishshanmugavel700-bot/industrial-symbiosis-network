-- Migration: production schedule entries
-- Stores both PDF-extracted and AI-predicted production slots.
-- Safe to run multiple times thanks to IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS production_schedule_entries (
    id               SERIAL PRIMARY KEY,
    factory_id       INTEGER REFERENCES factories(id) ON DELETE CASCADE,
    material_type    VARCHAR(100) NOT NULL,
    quantity_kg      NUMERIC      NOT NULL,
    production_date  TIMESTAMP    NOT NULL,
    source           VARCHAR(20)  NOT NULL CHECK (source IN ('pdf', 'predicted')),
    status           VARCHAR(20)  NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'purchased')),
    buyer_factory_id INTEGER REFERENCES factories(id) ON DELETE SET NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sched_material ON production_schedule_entries(material_type);
CREATE INDEX IF NOT EXISTS idx_sched_factory  ON production_schedule_entries(factory_id);
CREATE INDEX IF NOT EXISTS idx_sched_date     ON production_schedule_entries(production_date);
CREATE INDEX IF NOT EXISTS idx_sched_status   ON production_schedule_entries(status);
