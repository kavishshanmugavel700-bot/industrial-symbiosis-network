const jwt = require('jsonwebtoken');
const Match = require('../models/Match');
const Listing = require('../models/Listing');
const Factory = require('../models/Factory');
const Certificate = require('../models/Certificate');
const { calculateCo2Avoided, haversineKm } = require('../services/carbonCalculator.service');
const { generateCertificatePdf } = require('../services/pdfCertificate.service');
const { sendCertificateEmail } = require('../services/email.service');
const User = require('../models/User');
const env = require('../config/env');

const MATCH_ACTION_TOKEN_EXPIRES_IN = '7d'; // matches surplus alert relevance window

// Signed, short-lived token embedded in surplus-alert email links so a buyer
// can confirm/decline directly from their inbox without being logged in.
// Purpose-scoped and matchId-bound so it can't be reused for other matches.
function signMatchActionToken({ matchId, buyerFactoryId }) {
  return jwt.sign({ purpose: 'match_action', matchId, buyerFactoryId }, env.jwtSecret, {
    expiresIn: MATCH_ACTION_TOKEN_EXPIRES_IN,
  });
}

function verifyMatchActionToken(token, matchId) {
  const payload = jwt.verify(token, env.jwtSecret);
  if (payload.purpose !== 'match_action' || String(payload.matchId) !== String(matchId)) {
    throw new Error('Token does not authorize this match');
  }
  return payload;
}

// Confirms whether `actorFactoryId` is actually a party to this match
// (the buyer, or the seller via the underlying listing). Admins bypass.
async function assertIsPartyToMatch({ match, actorFactoryId, isAdmin }) {
  if (isAdmin) return;
  const listing = await Listing.findById(match.listing_id);
  const isBuyer = String(match.buyer_factory_id) === String(actorFactoryId);
  const isSeller = listing && String(listing.factory_id) === String(actorFactoryId);
  if (!isBuyer && !isSeller) {
    const err = new Error('Not authorized to act on this match');
    err.statusCode = 403;
    throw err;
  }
}

// Shared confirm logic used by both the authenticated (POST) route and the
// token-based email-link (GET) route.
async function performConfirm(matchId) {
  const match = await Match.findById(matchId);
  if (!match) {
    const err = new Error('Match not found');
    err.statusCode = 404;
    throw err;
  }
  if (match.status !== 'pending') {
    const err = new Error(`Match is already ${match.status}`);
    err.statusCode = 409;
    throw err;
  }

  const listing = await Listing.findById(match.listing_id);
  const sellerFactory = await Factory.findById(listing.factory_id);
  const buyerFactory = await Factory.findById(match.buyer_factory_id);

  const confirmed = await Match.confirm(match.id);
  await Listing.updateStatus(listing.id, 'matched');

  // A completed exchange is a positive trust signal for both parties.
  const TRUST_BUMP_ON_CONFIRM = 1;
  await Promise.all([
    Factory.updateTrustScore(sellerFactory.id, TRUST_BUMP_ON_CONFIRM),
    Factory.updateTrustScore(buyerFactory.id, TRUST_BUMP_ON_CONFIRM),
  ]);

  const { co2AvoidedKg } = await calculateCo2Avoided({
    materialType: listing.material_type,
    quantityKg: listing.quantity_kg,
    sellerLat: sellerFactory.latitude,
    sellerLon: sellerFactory.longitude,
    buyerLat: buyerFactory.latitude,
    buyerLon: buyerFactory.longitude,
  });

  const { buffer, certificateId } = await generateCertificatePdf({
    matchId: match.id,
    sellerName: sellerFactory.name,
    buyerName: buyerFactory.name,
    materialType: listing.material_type,
    quantityKg: listing.quantity_kg,
    co2AvoidedKg,
  });

  // NOTE: for the hackathon MVP the PDF is emailed as an attachment and its
  // "pdf_url" stored as a certificate id / local reference. Swap in real
  // object storage (S3 / Render disk) if a persistent download link is needed.
  const certificate = await Certificate.create({
    matchId: match.id,
    co2AvoidedKg,
    pdfUrl: `local://certificates/${certificateId}.pdf`,
  });

  const sellerUser = await User.findById(sellerFactory.user_id);
  const buyerUser = await User.findById(buyerFactory.user_id);
  await Promise.all([
    sendCertificateEmail({ to: sellerUser.email, pdfBuffer: buffer, filename: `${certificateId}.pdf` }),
    sendCertificateEmail({ to: buyerUser.email, pdfBuffer: buffer, filename: `${certificateId}.pdf` }),
  ]);

  return { match: confirmed, certificate };
}

async function performDecline(matchId) {
  const match = await Match.findById(matchId);
  if (!match) {
    const err = new Error('Match not found');
    err.statusCode = 404;
    throw err;
  }
  if (match.status !== 'pending') {
    const err = new Error(`Match is already ${match.status}`);
    err.statusCode = 409;
    throw err;
  }
  const declined = await Match.decline(matchId);
  return { match: declined };
}

async function createMatch(req, res) {
  try {
    const { listingId, compatibilityScore } = req.body;
    const buyerFactory = await Factory.findByUserId(req.user.id);
    if (!buyerFactory) return res.status(400).json({ error: 'No factory profile found for this user' });

    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const sellerFactory = await Factory.findById(listing.factory_id);
    if (!sellerFactory) return res.status(404).json({ error: 'Seller factory not found' });

    const existing = await Match.findPendingByListingAndBuyer(listingId, buyerFactory.id);
    if (existing) {
      return res.status(409).json({ error: 'A pending match already exists for this listing', match: existing });
    }

    // Call explainMatch with fallback logic
    let aiExplanation = `Strong match between ${sellerFactory.name} and ${buyerFactory.name} based on high material compatibility and geographical proximity.`;
    try {
      const distanceKm = haversineKm(
        sellerFactory.latitude,
        sellerFactory.longitude,
        buyerFactory.latitude,
        buyerFactory.longitude
      );
      const explanationRes = await aiClient.explainMatch({
        sellerMaterial: listing.material_type,
        sellerFactoryName: sellerFactory.name,
        buyerFactoryName: buyerFactory.name,
        buyerNeedsMaterial: buyerFactory.production_schedule?.needs_material_type || listing.material_type,
        compatibilityScore: Math.round((compatibilityScore || 0.90) * 100),
        distanceKm: Number(distanceKm.toFixed(1)),
        confidenceScore: Math.round((listing.confidence_score || 0.95) * 100),
        predictedSurplusDate: listing.predicted_surplus_date ? new Date(listing.predicted_surplus_date).toISOString().split('T')[0] : 'soon'
      });
      if (explanationRes && explanationRes.explanation) {
        aiExplanation = explanationRes.explanation;
      }
    } catch (err) {
      console.warn('[match.createMatch] AI explanation generation failed, using fallback:', err.message);
    }

    const match = await Match.create({
      listingId,
      buyerFactoryId: buyerFactory.id,
      compatibilityScore,
      aiExplanation
    });
    return res.status(201).json({ match });
  } catch (err) {
    console.error('[match.createMatch]', err);
    return res.status(500).json({ error: 'Failed to create match' });
  }
}

async function listMyMatches(req, res) {
  try {
    const factory = await Factory.findByUserId(req.user.id);
    if (!factory) return res.status(400).json({ error: 'No factory profile found for this user' });
    const matches = await Match.listForFactory(factory.id);
    return res.json({ matches });
  } catch (err) {
    console.error('[match.listMyMatches]', err);
    return res.status(500).json({ error: 'Failed to fetch matches' });
  }
}

// Authenticated route: POST /api/matches/:id/confirm (requires Bearer token).
// Only the buyer or seller on the match (or an admin) may confirm it.
async function confirmMatch(req, res) {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const actorFactory = await Factory.findByUserId(req.user.id);
    await assertIsPartyToMatch({
      match,
      actorFactoryId: actorFactory?.id,
      isAdmin: req.user.role === 'admin',
    });

    const result = await performConfirm(match.id);
    return res.json(result);
  } catch (err) {
    console.error('[match.confirmMatch]', err);
    return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to confirm match' });
  }
}

// Authenticated route: POST /api/matches/:id/decline (requires Bearer token).
async function declineMatch(req, res) {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const actorFactory = await Factory.findByUserId(req.user.id);
    await assertIsPartyToMatch({
      match,
      actorFactoryId: actorFactory?.id,
      isAdmin: req.user.role === 'admin',
    });

    const result = await performDecline(match.id);
    return res.json(result);
  } catch (err) {
    console.error('[match.declineMatch]', err);
    return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to decline match' });
  }
}

// Unauthenticated route: GET /api/matches/:id/confirm?token=... — hit
// directly when a buyer clicks the "Accept" button in a surplus-alert
// email. Authorization comes from the signed token, not a login session,
// since a browser click can't carry an Authorization header.
async function confirmMatchViaEmailLink(req, res) {
  try {
    verifyMatchActionToken(req.query.token, req.params.id);
    const result = await performConfirm(req.params.id);
    return res.send(
      `<h2>Match confirmed \u2705</h2><p>Certificate ID: ${result.certificate.id}. A carbon exchange certificate has been emailed to both parties.</p>`
    );
  } catch (err) {
    console.error('[match.confirmMatchViaEmailLink]', err);
    const status = err.statusCode || (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' ? 401 : 500);
    return res.status(status).send(`<h2>Could not confirm match</h2><p>${err.message}</p>`);
  }
}

// Unauthenticated route: GET /api/matches/:id/decline?token=...
async function declineMatchViaEmailLink(req, res) {
  try {
    verifyMatchActionToken(req.query.token, req.params.id);
    await performDecline(req.params.id);
    return res.send('<h2>Match declined</h2><p>You have declined this surplus match.</p>');
  } catch (err) {
    console.error('[match.declineMatchViaEmailLink]', err);
    const status = err.statusCode || (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' ? 401 : 500);
    return res.status(status).send(`<h2>Could not decline match</h2><p>${err.message}</p>`);
  }
}

module.exports = {
  createMatch,
  listMyMatches,
  confirmMatch,
  declineMatch,
  confirmMatchViaEmailLink,
  declineMatchViaEmailLink,
  signMatchActionToken,
};
