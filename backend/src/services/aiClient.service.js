const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
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

/**
 * Parses an MSDS PDF by forwarding it to the AI service's PDF upload endpoint.
 *
 * CONTRACT (Role 4 — compatibility_routes.py):
 *   POST /compatibility/parse-msds  multipart/form-data  field: "file"
 *   -> {
 *        material_name:       string,
 *        chemical_properties: object,
 *        isHazmat:            boolean,
 *        hazard_class:        string | null,
 *        reuse_potential:     "HIGH" | "MEDIUM" | "LOW",
 *        raw_text:            string
 *      }
 *
 * ── INTEGRATION NOTE FOR BACKEND LEAD (Role 1/2) ────────────────────────────
 * You need to add a multer (or busboy) route in Node that accepts the PDF from
 * the browser, writes it to a temp path, then calls parseMsds({ filePath }).
 * Example Express route skeleton:
 *
 *   const multer  = require('multer');
 *   const upload  = multer({ dest: 'uploads/' });
 *   const { parseMsds } = require('../services/aiClient.service');
 *
 *   router.post('/listings/parse-msds', upload.single('file'), async (req, res) => {
 *     try {
 *       const result = await parseMsds({ filePath: req.file.path });
 *       // Optionally clean up req.file.path with fs.unlink after this call
 *       res.json(result);
 *     } catch (err) {
 *       res.status(500).json({ error: err.message });
 *     }
 *   });
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @param {object} params
 * @param {string}   params.filePath  - Absolute path to the PDF file on disk.
 * @returns {Promise<object>} Parsed MSDS data from the AI service.
 */
async function parseMsds({ filePath }) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  const { data } = await client.post('/compatibility/parse-msds', form, {
    headers: form.getHeaders(),
    timeout: 30000, // PDF parsing may take longer than default 15 s
  });
  return data;
}

/**
 * Calls the AI service to explain why a match is strong.
 * CONTRACT:
 *   POST /compatibility/explain-match
 *   Body: { sellerMaterial, sellerFactoryName, buyerFactoryName, buyerNeedsMaterial,
 *           compatibilityScore, distanceKm, confidenceScore, predictedSurplusDate }
 *   -> { explanation: string }
 */
async function explainMatch({
  sellerMaterial,
  sellerFactoryName,
  buyerFactoryName,
  buyerNeedsMaterial,
  compatibilityScore,
  distanceKm,
  confidenceScore,
  predictedSurplusDate
}) {
  const { data } = await client.post('/compatibility/explain-match', {
    sellerMaterial,
    sellerFactoryName,
    buyerFactoryName,
    buyerNeedsMaterial,
    compatibilityScore,
    distanceKm,
    confidenceScore,
    predictedSurplusDate
  });
  return data;
}

module.exports = { predictSurplus, rankBuyers, scoreCompatibility, parseMsds, explainMatch };

