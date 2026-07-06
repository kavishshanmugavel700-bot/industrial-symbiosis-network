-- Industrial Symbiosis Intelligence Network — core schema (Role 1)

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) CHECK (role IN ('factory', 'buyer', 'admin')) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE factories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    industry_type VARCHAR(100),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    production_schedule JSONB,
    trust_score NUMERIC DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE listings (
    id SERIAL PRIMARY KEY,
    factory_id INTEGER REFERENCES factories(id),
    material_type VARCHAR(100),
    quantity_kg NUMERIC,
    predicted_surplus_date TIMESTAMP,
    confidence_score NUMERIC,
    status VARCHAR(20) DEFAULT 'open',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE matches (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER REFERENCES listings(id),
    buyer_factory_id INTEGER REFERENCES factories(id),
    compatibility_score NUMERIC,
    status VARCHAR(20) DEFAULT 'pending',
    confirmed_at TIMESTAMP
);

CREATE TABLE certificates (
    id SERIAL PRIMARY KEY,
    match_id INTEGER REFERENCES matches(id),
    co2_avoided_kg NUMERIC,
    pdf_url VARCHAR(500),
    issued_at TIMESTAMP DEFAULT NOW()
);

-- Taiwan EPA emission factors (Role 2 loads this from climate.moenv.gov.tw;
-- carbonCalculator.service.js falls back to hardcoded defaults if empty)
CREATE TABLE epa_emission_factors (
    id SERIAL PRIMARY KEY,
    material_type VARCHAR(100) UNIQUE NOT NULL,
    emission_factor NUMERIC NOT NULL,
    source VARCHAR(255) DEFAULT 'climate.moenv.gov.tw',
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_surplus_date ON listings(predicted_surplus_date);
CREATE INDEX idx_matches_listing ON matches(listing_id);
CREATE INDEX idx_matches_buyer_factory ON matches(buyer_factory_id);
CREATE INDEX idx_factories_user ON factories(user_id);
