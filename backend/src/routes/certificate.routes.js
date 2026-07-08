const express = require('express');
const router = express.Router();
const Certificate = require('../models/Certificate');
const Match = require('../models/Match');
const Listing = require('../models/Listing');
const Factory = require('../models/Factory');
const { generateCertificatePdf } = require('../services/pdfCertificate.service');
const authMiddleware = require('../middleware/auth.middleware');
const roleCheck = require('../middleware/roleCheck.middleware');

router.get('/', authMiddleware, roleCheck('admin'), async (req, res) => {
  try {
    const certificates = await Certificate.listAll();
    res.json({ certificates });
  } catch (err) {
    console.error('[certificate.list]', err);
    res.status(500).json({ error: 'Failed to fetch certificates' });
  }
});

router.get('/impact/total', async (req, res) => {
  try {
    const totalCo2AvoidedKg = await Certificate.totalCo2Avoided();
    res.json({ totalCo2AvoidedKg });
  } catch (err) {
    console.error('[certificate.totalImpact]', err);
    res.status(500).json({ error: 'Failed to fetch impact totals' });
  }
});

router.get('/:matchId/download', authMiddleware, async (req, res) => {
  try {
    const { matchId } = req.params;
    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    if (match.status !== 'confirmed') {
      return res.status(400).json({ error: 'Match must be confirmed to get a certificate' });
    }

    const listing = await Listing.findById(match.listing_id);
    const sellerFactory = await Factory.findById(listing.factory_id);
    const buyerFactory = await Factory.findById(match.buyer_factory_id);

    const actorFactory = await Factory.findByUserId(req.user.id);
    const isBuyer = actorFactory && String(match.buyer_factory_id) === String(actorFactory.id);
    const isSeller = actorFactory && listing && String(listing.factory_id) === String(actorFactory.id);
    const isAdmin = req.user.role === 'admin';

    if (!isBuyer && !isSeller && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to download this certificate' });
    }

    const certificateRecord = await Certificate.findByMatchId(matchId);
    if (!certificateRecord) {
      return res.status(404).json({ error: 'Certificate record not found' });
    }

    const { buffer, certificateId } = await generateCertificatePdf({
      matchId: match.id,
      sellerName: sellerFactory.name,
      buyerName: buyerFactory.name,
      materialType: listing.material_type,
      quantityKg: listing.quantity_kg,
      co2AvoidedKg: certificateRecord.co2_avoided_kg,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${certificateId}.pdf"`);
    return res.send(buffer);
  } catch (err) {
    console.error('[certificate.download]', err);
    return res.status(500).json({ error: 'Failed to generate and download certificate PDF' });
  }
});

module.exports = router;
