const axios = require('axios');
const env = require('../config/env');

const client = axios.create({ baseURL: env.aiServiceUrl, timeout: 15000 });

/**
 * Calls the Python Flask AI microservice to predict surplus for a factory's
 * production schedule. Expected AI-service contract (coordinate with Role 3):
 *   POST /predict/surplus  { factoryId, productionSchedule }
 *   -> { materialType, quantityKg, predictedSurplusDate, confidenceScore }
 */
async function predictSurplus({ factoryId, productionSchedule }) {
  const { data } = await client.post('/predict/surplus', { factoryId, productionSchedule });
  return data;
}

/**
 * Calls the AI service to rank candidate buyers for a given listing.
 * Contract (Role 4 — compatibility_routes.py):
 *   POST /compatibility/rank-buyers
 *   Body: { sellerMaterial, sellerLat, sellerLon, buyerFactories }
 *   -> { rankedBuyers: [{ factoryId, compatibilityScore, distanceKm, totalScore }, ...] }
 *
 * @param {object} params
 * @param {string}   params.sellerMaterial  - Material type the seller has surplus of.
 * @param {number}   params.sellerLat       - Seller factory latitude.
 * @param {number}   params.sellerLon       - Seller factory longitude.
 * @param {Array}    params.buyerFactories  - Candidate buyer factories from the DB.
 * @returns {Promise<Array>} Ranked buyer list (empty array on failure).
 */
async function rankBuyers({ sellerMaterial, sellerLat, sellerLon, buyerFactories }) {
  const { data } = await client.post('/compatibility/rank-buyers', {
    sellerMaterial,
    sellerLat,
    sellerLon,
    buyerFactories,
  });
  return data.rankedBuyers || [];
}


/**
 * Calls the AI service's NLP compatibility scorer for an uploaded MSDS.
 * Expected contract (coordinate with Role 4):
 *   POST /compatibility/score  { materialType, msdsText }
 *   -> { score, isHazmat }
 */
async function scoreCompatibility({ materialType, msdsText }) {
  const { data } = await client.post('/compatibility/score', { materialType, msdsText });
  return data;
}

module.exports = { predictSurplus, rankBuyers, scoreCompatibility };
