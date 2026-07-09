-- Wipes existing matches, listings, notifications, factories, and users to start fresh
DELETE FROM certificates;
DELETE FROM notifications;
DELETE FROM matches;
DELETE FROM listings;
DELETE FROM factories;
DELETE FROM users WHERE email IN ('q@gmail.com', 'tsmc@hsinchu.org', 'fpc@kaohsiung.com.tw', 'china.steel@kaohsiung.org', 'tainan.spin@tainan.org', 'admin@isin.gov.tw');

-- Pre-hashed bcrypt value for 'q'
-- ($2b$12$YcQBHsc06TQ5eHruKHBQeuUh1ZfHWdE.L88Alz53iKnKUNuXm/rlO)
INSERT INTO users (id, email, password_hash, role) VALUES
    (4, 'q@gmail.com', '$2b$12$YcQBHsc06TQ5eHruKHBQeuUh1ZfHWdE.L88Alz53iKnKUNuXm/rlO', 'buyer'),
    (10, 'tsmc@hsinchu.org', '$2b$12$YcQBHsc06TQ5eHruKHBQeuUh1ZfHWdE.L88Alz53iKnKUNuXm/rlO', 'factory'),
    (11, 'fpc@kaohsiung.com.tw', '$2b$12$YcQBHsc06TQ5eHruKHBQeuUh1ZfHWdE.L88Alz53iKnKUNuXm/rlO', 'factory'),
    (12, 'china.steel@kaohsiung.org', '$2b$12$YcQBHsc06TQ5eHruKHBQeuUh1ZfHWdE.L88Alz53iKnKUNuXm/rlO', 'factory'),
    (13, 'tainan.spin@tainan.org', '$2b$12$YcQBHsc06TQ5eHruKHBQeuUh1ZfHWdE.L88Alz53iKnKUNuXm/rlO', 'buyer'),
    (14, 'admin@isin.gov.tw', '$2b$12$YcQBHsc06TQ5eHruKHBQeuUh1ZfHWdE.L88Alz53iKnKUNuXm/rlO', 'admin');

-- Seed Factory Profiles (with accurate science park coordinate positions)
INSERT INTO factories (id, user_id, name, industry_type, latitude, longitude, trust_score, production_schedule) VALUES
    (4, 4, 'hello Inc', 'chemical', 22.6273, 120.3014, 2, '{"needs_material_type": "chemical_solvent", "weekly_demand_kg": 5000}'),
    (10, 10, 'TSMC Fab 12 (Hsinchu)', 'semiconductor', 24.7736, 121.0110, 5, '{"needs_material_type": "water", "weekly_demand_kg": 50000}'),
    (11, 11, 'Formosa Plastics (Kaohsiung)', 'chemical', 22.6101, 120.3120, 4, '{"needs_material_type": "water", "weekly_demand_kg": 20000}'),
    (12, 12, 'China Steel Corp (Kaohsiung)', 'metal', 22.5081, 120.3470, 6, '{"needs_material_type": "coal", "weekly_demand_kg": 100000}'),
    (13, 13, 'Tainan Spinning Co. (Tainan)', 'textile', 22.9908, 120.2248, 3, '{"needs_material_type": "heat_energy", "weekly_demand_kg": 12000}');

-- Seed Open and Predicted Listings
-- Adjust dates to be predicted (next 24h-72h) so they are targeted by the alert check
INSERT INTO listings (id, factory_id, material_type, quantity_kg, predicted_surplus_date, confidence_score, status) VALUES
    (100, 12, 'metal_offcut', 4500, NOW() + INTERVAL '36 hours', 0.96, 'open'),
    (101, 10, 'heat_energy', 15000, NOW() + INTERVAL '24 hours', 0.94, 'open'),
    (102, 11, 'chemical_solvent', 3500, NOW() + INTERVAL '48 hours', 0.98, 'open'),
    (103, 10, 'water', 12000, NULL, NULL, 'open');

-- Seed Historical Confirmed Matches (so charts are not blank)
INSERT INTO matches (id, listing_id, buyer_factory_id, compatibility_score, status, confirmed_at, ai_explanation) VALUES
    (200, 101, 13, 0.94, 'confirmed', NOW() - INTERVAL '2 days', 'TSMC generates high-temperature waste heat which perfectly matches Tainan Spinning industrial boiler inputs, avoiding virgin coal combustion. Logistics distance is highly feasible.'),
    (201, 102, 4, 0.92, 'confirmed', NOW() - INTERVAL '1 days', 'Strong chemical solvent recycling fit between Formosa Plastics and hello Inc. Direct supply-chain integration eliminates solvent incineration emissions.');

-- Seed Carbon Certificates for the historical matches
-- Avoided CO2: 
-- Match 200 (heat_energy, 15000 kWh): 15000 * 0.474 kg CO2e/kWh = 7110 kg
-- Match 201 (chemical_solvent, 3500 kg): 3500 * 2.85 kg CO2e/kg = 9975 kg
INSERT INTO certificates (match_id, co2_avoided_kg, pdf_url, issued_at) VALUES
    (200, 7110, 'local://certificates/ISN-200-ABCDEF.pdf', NOW() - INTERVAL '2 days'),
    (201, 9975, 'local://certificates/ISN-201-XYZ123.pdf', NOW() - INTERVAL '1 days');

-- Pre-seed in-app notification warnings for hello Inc (user 4)
INSERT INTO notifications (user_id, title, message, type, is_read, link_url, created_at) VALUES
    (4, 'Upcoming Surplus Warning: chemical_solvent', 'AI Prediction: A surplus of 3,500 kg of chemical_solvent is expected from Formosa Plastics (Kaohsiung) in 48 hours. Compatibility: 98%.', 'surplus_alert', FALSE, 'factory-profile.html', NOW() - INTERVAL '5 minutes'),
    (4, 'Symbiosis Exchange Confirmed!', 'Your match request with TSMC has been accepted. 7,110 kg of CO2e avoided.', 'info', TRUE, 'factory-profile.html', NOW() - INTERVAL '1 day');
