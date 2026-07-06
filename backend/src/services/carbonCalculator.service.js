const { query } = require('../config/db');

// Default fallback factors (kg CO2e per kg material) used if the EPA table
// (loaded via openDataTaiwan.service.js) doesn't have an entry for a material.
const FALLBACK_FACTORS = {
  chemical_solvent: 2.9,
  metal_offcut: 1.8,
  organic_sludge: 0.6,
  heat_energy: 0.25, // per kWh-equivalent, treated as kg-equivalent unit here
  water: 0.0003,
  plastic_offcut: 2.1,
  default: 1.0,
};

const TRANSPORT_EMISSION_FACTOR_PER_KM_KG = 0.00012; // kg CO2e per kg per km (road freight, rough default)

function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined)) return 0;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getEmissionFactor(materialType) {
  try {
    const { rows } = await query(
      `SELECT emission_factor FROM epa_emission_factors WHERE material_type = $1 LIMIT 1`,
      [materialType]
    );
    if (rows[0]) return Number(rows[0].emission_factor);
  } catch (err) {
    // Table may not exist yet in early stages — fall back silently.
  }
  return FALLBACK_FACTORS[materialType] || FALLBACK_FACTORS.default;
}

/**
 * CO2 avoided = weight_kg * (incineration_emission_factor - transport_emission_factor_for_this_trip)
 * Never returns a negative value (floored at 0).
 */
async function calculateCo2Avoided({ materialType, quantityKg, sellerLat, sellerLon, buyerLat, buyerLon }) {
  const incinerationFactor = await getEmissionFactor(materialType);
  const distanceKm = haversineKm(sellerLat, sellerLon, buyerLat, buyerLon);
  const transportFactor = TRANSPORT_EMISSION_FACTOR_PER_KM_KG * distanceKm;

  const perKgAvoided = Math.max(incinerationFactor - transportFactor, 0);
  const co2AvoidedKg = Number((perKgAvoided * quantityKg).toFixed(2));

  return { co2AvoidedKg, distanceKm: Number(distanceKm.toFixed(2)), incinerationFactor, transportFactor };
}

module.exports = { calculateCo2Avoided, haversineKm, getEmissionFactor };
