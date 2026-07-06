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
 * Expected contract (coordinate with Role 3):
 *   POST /rank/buyers  { listingId, materialType, sellerLat, sellerLon }
 *   -> { rankedBuyers: [{ factoryId, compatibilityScore }, ...] }
 */
async function rankBuyers({ listingId, materialType, sellerLat, sellerLon }) {
  const { data } = await client.post('/rank/buyers', { listingId, materialType, sellerLat, sellerLon });
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
