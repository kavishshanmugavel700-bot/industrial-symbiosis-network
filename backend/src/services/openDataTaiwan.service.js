const axios = require('axios');
const env = require('../config/env');

const client = axios.create({ baseURL: env.taiwanOpenDataApi, timeout: 10000 });

/**
 * Pulls factory registry entries from Taiwan's open data (data.gov.tw dataset #6358 —
 * Recycling Industry Directory). Falls back to an empty array if the API is
 * unreachable so it never blocks the demo.
 */
async function fetchFactoryRegistry({ limit = 50 } = {}) {
  try {
    const { data } = await client.get('/api/front/dataset/6358', { params: { limit } });
    return data;
  } catch (err) {
    console.warn('[openDataTaiwan] fetchFactoryRegistry failed, returning empty list:', err.message);
    return [];
  }
}

/**
 * Pulls EPA emission factor reference data. In practice this is usually
 * pre-seeded into the epa_emission_factors table (see database/schema.sql +
 * seed_synthetic_data.sql) so the app doesn't depend on a live call during
 * the demo, but this helper exists for the initial import job.
 */
async function fetchEpaEmissionFactors() {
  try {
    const { data } = await client.get('/api/emission-factors'); // placeholder path — confirm exact endpoint from moenv.gov.tw
    return data;
  } catch (err) {
    console.warn('[openDataTaiwan] fetchEpaEmissionFactors failed:', err.message);
    return [];
  }
}

module.exports = { fetchFactoryRegistry, fetchEpaEmissionFactors };
