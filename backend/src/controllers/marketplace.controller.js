const Listing = require('../models/Listing');
const Factory = require('../models/Factory');
const aiClient = require('../services/aiClient.service');

async function createListing(req, res) {
  try {
    const factory = await Factory.findByUserId(req.user.id);
    if (!factory) {
      return res.status(400).json({ error: 'No factory profile found for this user' });
    }

    const { materialType, quantityKg, predictedSurplusDate, confidenceScore } = req.body;
    if (!materialType || !quantityKg) {
      return res.status(400).json({ error: 'materialType and quantityKg are required' });
    }

    const listing = await Listing.create({
      factoryId: factory.id,
      materialType,
      quantityKg,
      predictedSurplusDate,
      confidenceScore,
    });

    return res.status(201).json({ listing });
  } catch (err) {
    console.error('[marketplace.createListing]', err);
    return res.status(500).json({ error: 'Failed to create listing' });
  }
}

async function browseListings(req, res) {
  try {
    const { materialType, minQuantity } = req.query;
    const listings = await Listing.listOpen({
      materialType: materialType || undefined,
      minQuantity: minQuantity ? Number(minQuantity) : undefined,
    });
    return res.json({ listings });
  } catch (err) {
    console.error('[marketplace.browseListings]', err);
    return res.status(500).json({ error: 'Failed to fetch listings' });
  }
}

async function getListing(req, res) {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    return res.json({ listing });
  } catch (err) {
    console.error('[marketplace.getListing]', err);
    return res.status(500).json({ error: 'Failed to fetch listing' });
  }
}

// Triggers the AI ranking for a listing on demand (also used by the cron job).
// Flow:
//   1. Load the listing and its seller factory.
//   2. Query all factories that need the same material type (candidate buyers).
//   3. Forward the candidate list to the AI service for scoring + ranking.
async function rankBuyersForListing(req, res) {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const sellerFactory = await Factory.findById(listing.factory_id);
    if (!sellerFactory) return res.status(404).json({ error: 'Seller factory not found' });

    // Fetch candidate buyers: factories whose production_schedule records that
    // they need the same material the seller is offering as surplus.
    const buyerFactories = await Factory.findByNeedsMaterial(listing.material_type);

    const rankedBuyers = await aiClient.rankBuyers({
      sellerMaterial: listing.material_type,
      sellerLat: sellerFactory.latitude,
      sellerLon: sellerFactory.longitude,
      buyerFactories,   // shape: [{ factory_id, needs_material_type, latitude, longitude, trust_score }]
    });

    return res.json({ rankedBuyers });
  } catch (err) {
    console.error('[marketplace.rankBuyersForListing]', err.message);
    return res.status(502).json({ error: 'AI service unavailable', detail: err.message });
  }
}


module.exports = { createListing, browseListings, getListing, rankBuyersForListing };
