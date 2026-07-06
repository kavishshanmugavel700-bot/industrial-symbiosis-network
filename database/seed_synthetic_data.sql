-- Seed EPA emission factors used by carbonCalculator.service.js
-- Values are placeholders — replace with exact figures from climate.moenv.gov.tw before demo day.
INSERT INTO epa_emission_factors (material_type, emission_factor) VALUES
    ('chemical_solvent', 2.9),
    ('metal_offcut', 1.8),
    ('organic_sludge', 0.6),
    ('heat_energy', 0.25),
    ('water', 0.0003),
    ('plastic_offcut', 2.1)
ON CONFLICT (material_type) DO NOTHING;

-- Synthetic factories for demo (Role 4 will replace/extend this with the
-- Python-generated dataset in ai-service/data/synthetic_taiwan_factories.csv)
-- Example structure once users exist:
-- INSERT INTO factories (user_id, name, industry_type, latitude, longitude)
-- VALUES (1, 'Taoyuan Plastics Co.', 'plastics', 24.9936, 121.3010);
