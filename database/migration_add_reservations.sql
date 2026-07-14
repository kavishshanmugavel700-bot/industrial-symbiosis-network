-- Migration: production schedule reservations
-- Creates table to track multiple pending buyer requests for a single production slot.

CREATE TABLE IF NOT EXISTS production_schedule_reservations (
    id               SERIAL PRIMARY KEY,
    entry_id         INTEGER REFERENCES production_schedule_entries(id) ON DELETE CASCADE,
    buyer_factory_id INTEGER REFERENCES factories(id) ON DELETE CASCADE,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_res_entry ON production_schedule_reservations(entry_id);
CREATE INDEX IF NOT EXISTS idx_res_buyer ON production_schedule_reservations(buyer_factory_id);
