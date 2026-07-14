const fs = require('fs');
const path = require('path');
const Factory = require('../models/Factory');
const ProductionScheduleEntry = require('../models/ProductionScheduleEntry');
const ProductionScheduleReservation = require('../models/ProductionScheduleReservation');
const aiClient = require('../services/aiClient.service');
const { generatePurchaseConfirmationPdf } = require('../services/pdfCertificate.service');
const { query } = require('../config/db'); // used to create system notifications

// ---------------------------------------------------------------------------
// POST /api/listings/upload-schedule
// ---------------------------------------------------------------------------
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

    await ProductionScheduleEntry.deleteByFactory(factory.id);

    const pdfEntries = extractedRows.map((row) => ({
      factoryId:      factory.id,
      materialType:   row.material_type,
      quantityKg:     row.quantity_kg,
      productionDate: row.production_date,
      source:         'pdf',
    }));

    await ProductionScheduleEntry.bulkInsert(pdfEntries);

    const dates = extractedRows
      .map((r) => new Date(r.production_date))
      .filter((d) => !isNaN(d));
    const maxPdfDate = dates.length > 0 ? new Date(Math.max(...dates)) : new Date();

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
      const step = 14;

      while (currentDate <= maxPdfDate) {
        currentDate = new Date(currentDate.getTime() + step * 24 * 60 * 60 * 1000);
      }

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
    if (tmpPath) {
      fs.unlink(tmpPath, () => {});
    }
  }
}

// ---------------------------------------------------------------------------
// GET /api/listings/search?material=<name>
// ---------------------------------------------------------------------------
async function searchSchedules(req, res) {
  try {
    const { material } = req.query;
    if (!material || !material.trim()) {
      return res.status(400).json({ error: 'Query parameter "material" is required.' });
    }

    const materialQuery = material.trim();
    const buyerFactory = await Factory.findByUserId(req.user.id);
    const candidateFactories = await ProductionScheduleEntry.findFactoriesByMaterial(materialQuery);

    if (candidateFactories.length === 0) {
      return res.json({ factories: [] });
    }

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
// POST /api/listings/reserve
// ---------------------------------------------------------------------------
async function requestSlotReservation(req, res) {
  try {
    const { entryId } = req.body;
    if (!entryId) {
      return res.status(400).json({ error: '"entryId" is required.' });
    }

    const entry = await ProductionScheduleEntry.findById(entryId);
    if (!entry) {
      return res.status(404).json({ error: 'Production slot not found.' });
    }
    if (entry.status !== 'open') {
      return res.status(409).json({ error: 'This production slot is no longer available.' });
    }

    const buyerFactory = await Factory.findByUserId(req.user.id);
    if (!buyerFactory) {
      return res.status(400).json({ error: 'No factory profile found for this user.' });
    }

    if (String(buyerFactory.id) === String(entry.factory_id)) {
      return res.status(400).json({ error: 'You cannot request your own production slot.' });
    }

    const sellerFactory = await Factory.findById(entry.factory_id);
    if (!sellerFactory) {
      return res.status(404).json({ error: 'Seller factory not found.' });
    }

    // Prevent duplicate requests
    const existing = await ProductionScheduleReservation.findDuplicate(entry.id, buyerFactory.id);
    if (existing) {
      return res.status(409).json({ error: 'You have already submitted a reservation request for this slot.' });
    }

    // -- Call AI service to generate a match explanation block --
    let aiExplanation = '';
    let compatibilityScore = 80; // default/fallback
    let distanceKm = 100;        // default/fallback

    if (sellerFactory.latitude && sellerFactory.longitude && buyerFactory.latitude && buyerFactory.longitude) {
      try {
        // Get precise compatibility scores and distance
        const ranked = await aiClient.rankBuyers({
          sellerMaterial: entry.material_type,
          sellerLat:      sellerFactory.latitude,
          sellerLon:      sellerFactory.longitude,
          buyerFactories: [{
            factory_id:          buyerFactory.id,
            needs_material_type: buyerFactory.needs_material_type || entry.material_type,
            latitude:            buyerFactory.latitude,
            longitude:           buyerFactory.longitude,
            trust_score:         buyerFactory.trust_score || 50,
          }],
        });

        if (ranked && ranked.length > 0) {
          compatibilityScore = Math.round(ranked[0].compatibilityScore || 80);
          distanceKm         = Number((ranked[0].distanceKm || 100).toFixed(1));
        }

        // Get live LLM explanation
        const aiExplainResult = await aiClient.explainMatch({
          sellerMaterial:      entry.material_type,
          sellerFactoryName:   sellerFactory.name,
          buyerFactoryName:    buyerFactory.name,
          buyerNeedsMaterial:  buyerFactory.needs_material_type || entry.material_type,
          compatibilityScore:  compatibilityScore,
          distanceKm:          distanceKm,
          confidenceScore:     0.95,
          predictedSurplusDate: entry.production_date,
        });

        aiExplanation = aiExplainResult.explanation || '';
      } catch (aiErr) {
        console.warn('[production.requestSlotReservation] AI explanation failed (non-fatal):', aiErr.message);
      }
    }

    // Fallback explanation if AI service is offline or errors
    if (!aiExplanation) {
      const materialName = entry.material_type.replace(/_/g, ' ');
      aiExplanation = `This industrial symbiosis match is strong due to the material compatibility score of ${compatibilityScore}%, indicating a high likelihood of successful ${materialName} transfer between ${sellerFactory.name} and ${buyerFactory.name}. The geographical feasibility is also favorable, with a relatively short distance of ${distanceKm} km between the factories, facilitating efficient transportation.`;
    }

    const reservation = await ProductionScheduleReservation.create({
      entryId: entry.id,
      buyerFactoryId: buyerFactory.id,
      aiExplanation,
    });

    return res.status(201).json({
      message: 'Reservation request submitted successfully. Waiting for seller approval.',
      reservation,
    });
  } catch (err) {
    console.error('[production.requestSlotReservation]', err);
    return res.status(500).json({ error: 'Failed to submit reservation request.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/listings/reservations/incoming
// ---------------------------------------------------------------------------
async function getIncomingRequests(req, res) {
  try {
    const sellerFactory = await Factory.findByUserId(req.user.id);
    if (!sellerFactory) {
      return res.status(400).json({ error: 'No factory profile found for this user.' });
    }

    const rawRequests = await ProductionScheduleReservation.findIncomingBySeller(sellerFactory.id);

    // Calculate AI compatibility for each incoming candidate
    const scoredRequests = [];
    for (const r of rawRequests) {
      let compatibilityScore = null;
      let distanceKm = null;
      let totalScore = 0;

      if (sellerFactory.latitude && sellerFactory.longitude && r.buyer_latitude && r.buyer_longitude) {
        try {
          const ranked = await aiClient.rankBuyers({
            sellerMaterial: r.material_type,
            sellerLat:      sellerFactory.latitude,
            sellerLon:      sellerFactory.longitude,
            buyerFactories: [{
              factory_id:          r.buyer_factory_id,
              needs_material_type: r.material_type,
              latitude:            r.buyer_latitude,
              longitude:           r.buyer_longitude,
              trust_score:         r.buyer_trust || 50,
            }],
          });

          if (ranked && ranked.length > 0) {
            compatibilityScore = ranked[0].compatibilityScore || null;
            distanceKm         = ranked[0].distanceKm         || null;
            totalScore         = ranked[0].totalScore         || 0;
          }
        } catch (aiErr) {
          console.warn('[production.getIncomingRequests] AI scoring failed (non-fatal):', aiErr.message);
        }
      }

      scoredRequests.push({
        reservationId:      r.reservation_id,
        reservationStatus:  r.reservation_status,
        aiExplanation:      r.ai_explanation,
        createdAt:          r.created_at,
        slotId:             r.slot_id,
        materialType:       r.material_type,
        quantityKg:         Number(r.quantity_kg),
        productionDate:     r.production_date,
        slotSource:         r.slot_source,
        buyerFactoryId:     r.buyer_factory_id,
        buyerName:          r.buyer_name,
        buyerIndustry:      r.buyer_industry,
        compatibilityScore: compatibilityScore ? Math.round(compatibilityScore) : null,
        distanceKm:         distanceKm ? Number(distanceKm.toFixed(1)) : null,
        totalScore:         totalScore ? Math.round(totalScore) : 0,
      });
    }

    // Sort by AI recommendation totalScore descending
    scoredRequests.sort((a, b) => b.totalScore - a.totalScore);

    return res.json({ requests: scoredRequests });
  } catch (err) {
    console.error('[production.getIncomingRequests]', err);
    return res.status(500).json({ error: 'Failed to fetch incoming reservation requests.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/listings/reservations/outgoing
// ---------------------------------------------------------------------------
async function getOutgoingRequests(req, res) {
  try {
    const buyerFactory = await Factory.findByUserId(req.user.id);
    if (!buyerFactory) {
      return res.status(400).json({ error: 'No factory profile found for this user.' });
    }

    const reservations = await ProductionScheduleReservation.findOutgoingByBuyer(buyerFactory.id);
    return res.json({
      reservations: reservations.map(r => ({
        reservationId:     r.reservation_id,
        reservationStatus: r.reservation_status,
        createdAt:         r.created_at,
        slotId:            r.slot_id,
        materialType:      r.material_type,
        quantityKg:        Number(r.quantity_kg),
        productionDate:    r.production_date,
        slotSource:        r.slot_source,
        sellerFactoryId:   r.seller_factory_id,
        sellerName:        r.seller_name,
      })),
    });
  } catch (err) {
    console.error('[production.getOutgoingRequests]', err);
    return res.status(500).json({ error: 'Failed to fetch outgoing reservations.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/listings/reservations/:id/approve
// ---------------------------------------------------------------------------
async function approveReservation(req, res) {
  try {
    const reservationId = parseInt(req.params.id, 10);
    if (isNaN(reservationId)) {
      return res.status(400).json({ error: 'Invalid reservation ID.' });
    }

    const reservation = await ProductionScheduleReservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation request not found.' });
    }

    const sellerFactory = await Factory.findByUserId(req.user.id);
    if (!sellerFactory || String(sellerFactory.id) !== String(reservation.seller_factory_id)) {
      return res.status(403).json({ error: 'You are not authorized to approve requests for this slot.' });
    }

    if (reservation.reservation_status !== 'pending') {
      return res.status(400).json({ error: `Reservation request is already ${reservation.reservation_status}.` });
    }

    // 1. Approve this reservation and reject competing ones in DB
    await ProductionScheduleReservation.approve(reservation.id, reservation.entry_id);

    // 2. Lock the production slot entry as purchased
    await ProductionScheduleEntry.markPurchased(reservation.entry_id, reservation.buyer_factory_id);

    // 3. Send system notification to the winning buyer
    try {
      const buyerUserRes = await query('SELECT user_id FROM factories WHERE id = $1', [reservation.buyer_factory_id]);
      if (buyerUserRes.rows[0]) {
        const buyerUserId = buyerUserRes.rows[0].user_id;
        await query(
          `INSERT INTO notifications (user_id, title, message, type, link_url)
           VALUES ($1, $2, $3, 'system', 'factory-profile.html')`,
          [
            buyerUserId,
            'Reservation Approved! 🎉',
            `Your request for ${reservation.quantity_kg}kg of ${reservation.material_type} from ${sellerFactory.name} was approved. Download your receipt in My Profile.`,
          ]
        );
      }
    } catch (notifErr) {
      console.warn('[production.approveReservation] Failed to insert notification (non-fatal):', notifErr.message);
    }

    return res.json({ message: 'Reservation request approved successfully.' });
  } catch (err) {
    console.error('[production.approveReservation]', err);
    return res.status(500).json({ error: 'Failed to approve reservation request.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/listings/reservations/:id/receipt
// ---------------------------------------------------------------------------
async function downloadReceipt(req, res) {
  try {
    const reservationId = parseInt(req.params.id, 10);
    if (isNaN(reservationId)) {
      return res.status(400).json({ error: 'Invalid reservation ID.' });
    }

    const reservation = await ProductionScheduleReservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found.' });
    }

    // Verify requesting user is either the buyer or the seller
    const userFactory = await Factory.findByUserId(req.user.id);
    if (!userFactory) {
      return res.status(400).json({ error: 'No factory profile found for this user.' });
    }

    const isBuyer = String(userFactory.id) === String(reservation.buyer_factory_id);
    const isSeller = String(userFactory.id) === String(reservation.seller_factory_id);

    if (!isBuyer && !isSeller) {
      return res.status(403).json({ error: 'You are not authorized to access this receipt.' });
    }

    if (reservation.reservation_status !== 'approved') {
      return res.status(400).json({ error: 'Receipt is only available for approved reservations.' });
    }

    const { buffer, confirmationId } = await generatePurchaseConfirmationPdf({
      entryId:        reservation.entry_id,
      sellerName:     reservation.seller_name,
      buyerName:      reservation.buyer_name,
      materialType:   reservation.material_type,
      quantityKg:     Number(reservation.quantity_kg),
      productionDate: reservation.production_date,
      source:         reservation.source,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${confirmationId}.pdf"`);
    return res.send(buffer);
  } catch (err) {
    console.error('[production.downloadReceipt]', err);
    return res.status(500).json({ error: 'Failed to download receipt.' });
  }
}

module.exports = {
  uploadSchedule,
  searchSchedules,
  getFactorySchedule,
  requestSlotReservation,
  getIncomingRequests,
  getOutgoingRequests,
  approveReservation,
  downloadReceipt,
};
