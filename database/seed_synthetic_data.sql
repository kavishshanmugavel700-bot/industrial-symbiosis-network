-- Seed EPA emission factors used by carbonCalculator.service.js
--
-- Values sourced from official Taiwan government publications and IPCC 2006 defaults.
-- Primary sources:
--   electricity / heat_energy : Bureau of Energy, MOEA — announced 2024-02-05 (ROC Year 113)
--                               https://www.moeaea.gov.tw/
--   all other materials        : Taiwan MOENV GHG Emission Factor Management Table
--                               https://ghgregistry.moenv.gov.tw/
--   water                      : Taiwan Water Corporation ESG Report 2023
--                               https://data.gov.tw/
--
-- Units: kg CO2-equivalent per kg of material (IPCC AR5 GWP100 basis)
--        heat_energy uses kWh-equivalent unit (1 kWh treated as 1 kg for the calculator)
--
-- ON CONFLICT DO UPDATE ensures re-running this seed always refreshes stale values.

INSERT INTO epa_emission_factors (material_type, emission_factor) VALUES
    ('chemical_solvent',    2.85),   -- IPCC 2006 Vol.5 fossil liquid waste; MOENV adjustment applied
    ('metal_offcut',        1.82),   -- World Steel Assoc. 2023 LCA; avoided virgin production credit
    ('organic_sludge',      0.58),   -- IPCC biogenic + CH4/N2O co-emissions GWP100; MOENV sludge guidelines
    ('heat_energy',         0.474),  -- OFFICIAL: Taiwan Bureau of Energy 2024 electricity factor (kg CO2e/kWh)
                                     -- (2023 factor was 0.494; 2024 mandatory reporting factor is 0.474)
    ('water',               0.000150), -- Taiwan Water Corporation ESG 2023: 0.150 kg CO2e/m³ = 0.000150 kg/kg
    ('plastic_offcut',      2.10),   -- IPCC mixed plastic incineration; MOENV blended-plastic correction
    ('textile_dyeing_waste',1.65),   -- Taiwan Textile Federation 2022; 60/40 polyester/cotton blend
    ('paper_sludge',        0.39)    -- MOENV solid waste sector 2023; CH4 from landfill GWP100
ON CONFLICT (material_type) DO UPDATE
    SET emission_factor = EXCLUDED.emission_factor,
        updated_at      = NOW();

-- Synthetic factories for demo (Role 4 will replace/extend this with the
-- Python-generated dataset in ai-service/data/synthetic_taiwan_factories.csv)
-- Example structure once users exist:
-- INSERT INTO factories (user_id, name, industry_type, latitude, longitude)
-- VALUES (1, 'Taoyuan Plastics Co.', 'plastics', 24.9936, 121.3010);
