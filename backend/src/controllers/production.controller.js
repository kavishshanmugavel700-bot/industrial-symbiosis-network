const fs = require('fs');
const path = require('path');
const Factory = require('../models/Factory');
const ProductionScheduleEntry = require('../models/ProductionScheduleEntry');
const aiClient = require('../services/aiClient.service');
const { generatePurchaseConfirmationPdf } = require('../services/pdfCertificate.service');

// ---------------------------------------------------------------------------
// POST /api/listings/upload-schedule
// ---------------------------------------------------------------------------

/**
 * Accept a PDF from a seller, extract it via the AI service, bulk-insert the
 * extracted rows, then call the existing surplus prediction to generate
 * additional AI-forecast slots beyond the PDF's date range.
 *
 * Auth: requires 'factory' role (enforced in routes file via authMiddleware + roleCheck).
 */
async function uploadSchedule(req, res) {
  const tmpPath = req.file ? req.file.path : null;
  try {
    if (!tmpPath) {
      return res.status(400).json({ error: 'No PDF file received. Send as multipart field "file".' });
    }

    const factory = await Factory.findByUserId(req.user.id);
    if (!factory) {
      return res.status(400).json({ error: 'No factory profile found for this user.' });
    }

    // -- Step 1: Forward PDF to AI service for extraction --------------------
    let extractedRows = [];
    try {
      const aiResult = await aiClient.extractProductionSchedule({
        filePath: path.resolve(tmpPath),
        factoryId: factory.id,
      });
      extractedRows = aiResult.extractedRows || [];
    } catch (aiErr) {
      console.error('[production.uploadSchedule] AI extraction failed:', aiErr.message);
      return res.status(502).json({
        error: 'AI service could not parse the PDF.',
        detail: aiErr.message,
      });
    }

    if (extractedRows.length === 0) {
      return res.status(422).json({
        error: 'No valid production schedule rows could be extracted from the PDF. '
          + 'Ensure the PDF contains a table with material type, quantity (kg), and date columns.',
      });
    }

    // -- Step 2: Clear old entries for this factory & bulk-insert new ones ----
    await ProductionScheduleEntry.deleteByFactory(factory.id);

    const pdfEntries = extractedRows.map((row) => ({
      factoryId:      factory.id,
      materialType:   row.material_type,
      quantityKg:     row.quantity_kg,
      productionDate: row.production_date,
      source:         'pdf',
    }));

    await ProductionScheduleEntry.bulkInsert(pdfEntries);

    // -- Step 3: Generate AI-predicted slots beyond the PDF's date range ------
    // Find the latest date in the extracted rows.
    const dates = extractedRows
      .map((r) => new Date(r.production_date))
      .filter((d) => !isNaN(d));
    const maxPdfDate = dates.length > 0 ? new Date(Math.max(...dates)) : new Date();

    // Get all unique material types from the PDF schedule
    const uniqueMaterials = [...new Set(extractedRows.map((r) => r.material_type))];
    let totalPredictedAdded = 0;

    for (const material of uniqueMaterials) {
      let predictionResult = null;
      try {
        predictionResult = await aiClient.predictSurplus({
          factoryId: factory.id,
          productionSchedule: {
            material_type: material
          },
        });
      } catch (predErr) {
        console.warn(`[production.uploadSchedule] predictSurplus failed for ${material} (non-fatal):`, predErr.message);
      }

      const predQuantityKg = (predictionResult && predictionResult.quantityKg) 
        || (extractedRows.find((r) => r.material_type === material) || {}).quantity_kg 
        || 1000;

      let currentDate = new Date((predictionResult && predictionResult.predictedSurplusDate) || maxPdfDate);
      const step = 14; // 2-week cadence for forecast slots

      while (currentDate <= maxPdfDate) {
        currentDate = new Date(currentDate.getTime() + step * 24 * 60 * 60 * 1000);
      }

      // Insert 3 predicted slots at 2-week intervals for this material
      const predictedEntries = [];
      for (let i = 0; i < 3; i++) {
        predictedEntries.push({
          factoryId:      factory.id,
          materialType:   material,
          quantityKg:     predQuantityKg,
          productionDate: currentDate.toISOString(),
          source:         'predicted',
        });
        currentDate = new Date(currentDate.getTime() + step * 24 * 60 * 60 * 1000);
      }
      await ProductionScheduleEntry.bulkInsert(predictedEntries);
      totalPredictedAdded += 3;
    }

    return res.status(201).json({
      message: 'Production schedule uploaded and stored successfully.',
      pdfRowCount: extractedRows.length,
      predictedRowsAdded: totalPredictedAdded,
    });
  } catch (err) {
    console.error('[production.uploadSchedule]', err);
    return res.status(500).json({ error: 'Failed to process production schedule upload.' });
  } finally {
    // Always clean up the temp file
    if (tmpPath) {
      fs.unlink(tmpPath, () => {});
    }
  }
}

// ---------------------------------------------------------------------------
// GET /api/listings/search?material=<name>
// ---------------------------------------------------------------------------

/**
 * Search for factories selling a given material type.
 * Returns each factory ranked by AI compatibility with the buyer's profile.
 *
 * Auth: requires any authenticated user.
 */
async function searchSchedules(req, res) {
  try {
    const { material } = req.query;
    if (!material || !material.trim()) {
      return res.status(400).json({ error: 'Query parameter "material" is required.' });
    }

    const materialQuery = material.trim();

    // Get buyer's factory for scoring context
    const buyerFactory = await Factory.findByUserId(req.user.id);

    // Find all factories with matching schedule entries
    const candidateFactories = await ProductionScheduleEntry.findFactoriesByMaterial(materialQuery);

    if (candidateFactories.length === 0) {
      return res.json({ factories: [] });
    }

    // Rank via AI compatibility — we re-use rankBuyers by treating the buyer's
    // factory as the "seller" and the candidate seller factories as "buyers".
    // The distance and trust math is symmetric; compatibility scores will be high
    // because all factories share the same material type (seller material == buyer needs).
    let rankedFactories = candidateFactories;
    if (buyerFactory && buyerFactory.latitude && buyerFactory.longitude) {
      try {
        const ranked = await aiClient.rankBuyers({
          sellerMaterial: materialQuery,
          sellerLat:      buyerFactory.latitude,
          sellerLon:      buyerFactory.longitude,
          buyerFactories: candidateFactories.map((f) => ({
            factory_id:          f.factory_id,
            needs_material_type: f.needs_material_type || materialQuery,
            latitude:            f.latitude,
            longitude:           f.longitude,
            trust_score:         f.trust_score || 50,
          })),
        });

        // Merge score data back onto the factory rows
        const scoreMap = new Map(ranked.map((r) => [String(r.factoryId), r]));
        rankedFactories = candidateFactories
          .map((f) => {
            const score = scoreMap.get(String(f.factory_id)) || {};
            return {
              ...f,
              compatibilityScore: score.compatibilityScore || null,
              distanceKm:         score.distanceKm         || null,
              totalScore:         score.totalScore         || 0,
            };
          })
          .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
      } catch (aiErr) {
        // AI ranking failed — return unranked list
        console.warn('[production.searchSchedules] AI ranking failed (non-fatal):', aiErr.message);
      }
    }

    return res.json({ factories: rankedFactories });
  } catch (err) {
    console.error('[production.searchSchedules]', err);
    return res.status(500).json({ error: 'Failed to search production schedules.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/factories/:id/schedule?material=<name>
// ---------------------------------------------------------------------------

/**
 * Return a single factory's full list of production schedule slots,
 * optionally filtered by material type, sorted ascending by date.
 *
 * Auth: requires any authenticated user.
 */
async function getFactorySchedule(req, res) {
  try {
    const factoryId = parseInt(req.params.id, 10);
    if (isNaN(factoryId)) {
      return res.status(400).json({ error: 'Invalid factory ID.' });
    }

    const factory = await Factory.findById(factoryId);
    if (!factory) {
      return res.status(404).json({ error: 'Factory not found.' });
    }

    const material = req.query.material ? req.query.material.trim() : null;
    const slots    = await ProductionScheduleEntry.findByFactory(factoryId, material);

    return res.json({
      factory: {
        id:           factory.id,
        name:         factory.name,
        industryType: factory.industry_type,
        latitude:     factory.latitude,
        longitude:    factory.longitude,
        trustScore:   factory.trust_score,
      },
      slots: slots.map((s) => ({
        id:             s.id,
        materialType:   s.material_type,
        quantityKg:     Number(s.quantity_kg),
        productionDate: s.production_date,
        source:         s.source,
        status:         s.status,
      })),
    });
  } catch (err) {
    console.error('[production.getFactorySchedule]', err);
    return res.status(500).json({ error: 'Failed to fetch factory schedule.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/listings/purchase
// ---------------------------------------------------------------------------

/**
 * Purchase / reserve a production schedule slot.
 * Body: { entryId }
 *
 * Marks the entry as 'purchased', links the buyer factory, and returns a
 * downloadable PDF confirmation receipt.
 *
 * Auth: requires any authenticated user with a factory profile.
 */
async function purchaseSlot(req, res) {
  try {
    const { entryId } = req.body;
    if (!entryId) {
      return res.status(400).json({ error: '"entryId" is required.' });
    }

    const entry = await ProductionScheduleEntry.findById(entryId);
    if (!entry) {
      return res.status(404).json({ error: 'Schedule entry not found.' });
    }
    if (entry.status !== 'open') {
      return res.status(409).json({ error: 'This slot is no longer available.' });
    }

    const buyerFactory  = await Factory.findByUserId(req.user.id);
    if (!buyerFactory) {
      return res.status(400).json({ error: 'No factory profile found for this user.' });
    }

    if (String(buyerFactory.id) === String(entry.factory_id)) {
      return res.status(400).json({ error: 'You cannot purchase your own slot.' });
    }

    const sellerFactory = await Factory.findById(entry.factory_id);
    if (!sellerFactory) {
      return res.status(404).json({ error: 'Seller factory not found.' });
    }

    // Mark as purchased
    await ProductionScheduleEntry.markPurchased(entry.id, buyerFactory.id);

    // Generate confirmation PDF
    const { buffer, confirmationId } = await generatePurchaseConfirmationPdf({
      entryId:        entry.id,
      sellerName:     sellerFactory.name,
      buyerName:      buyerFactory.name,
      materialType:   entry.material_type,
      quantityKg:     Number(entry.quantity_kg),
      productionDate: entry.production_date,
      source:         entry.source,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${confirmationId}.pdf"`);
    return res.send(buffer);
  } catch (err) {
    console.error('[production.purchaseSlot]', err);
    return res.status(500).json({ error: 'Failed to purchase slot.' });
  }
}

module.exports = { uploadSchedule, searchSchedules, getFactorySchedule, purchaseSlot };
