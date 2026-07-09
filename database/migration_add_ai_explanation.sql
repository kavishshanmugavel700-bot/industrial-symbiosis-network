-- Migration to add AI explanation to matches table
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ai_explanation TEXT;
