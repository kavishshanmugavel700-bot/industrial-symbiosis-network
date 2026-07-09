const cron = require('node-cron');
const Listing = require('../models/Listing');
const Factory = require('../models/Factory');
const Match = require('../models/Match');
const User = require('../models/User');
const Notification = require('../models/Notification');
const aiClient = require('../services/aiClient.service');
const { sendSurplusAlert } = require('../services/email.service');
const { signMatchActionToken } = require('../controllers/match.controller');
const env = require('../config/env');

const APP_URL = process.env.APP_URL || 'http://localhost:4000';

async function runSurplusAlertCheck() {
  console.log('[cron] Checking for upcoming predicted surplus (next 72h)...');
  try {
    const upcoming = await Listing.findUpcomingSurplus(72);
    if (upcoming.length === 0) {
      console.log('[cron] No upcoming surplus found.');
      return;
    }

    for (const listing of upcoming) {
      const sellerFactory = await Factory.findById(listing.factory_id);
      if (!sellerFactory) continue;

      // Query candidate buyer factories that need this material type
      const buyerFactories = await Factory.findByNeedsMaterial(listing.material_type);

      let rankedBuyers = [];
      try {
        rankedBuyers = await aiClient.rankBuyers({
          sellerMaterial: listing.material_type,
          sellerLat: sellerFactory.latitude,
          sellerLon: sellerFactory.longitude,
          buyerFactories,
        });
      } catch (err) {
        console.error(`[cron] AI ranking failed for listing ${listing.id}:`, err.message);
        continue;
      }

      // Alert the top 3 ranked buyers
      for (const ranked of rankedBuyers.slice(0, 3)) {
        const buyerFactory = await Factory.findById(ranked.factoryId);
        if (!buyerFactory) continue;
        const buyerUser = await User.findById(buyerFactory.user_id);
        if (!buyerUser) continue;

        const alreadyPending = await Match.findPendingByListingAndBuyer(listing.id, buyerFactory.id);
        if (alreadyPending) {
          console.log(`[cron] Skipping duplicate match for listing ${listing.id} / buyer ${buyerFactory.id} (already pending)`);
          continue;
        }

        // Call explainMatch with fallback logic
        let aiExplanation = `Strong match between ${sellerFactory.name} and ${buyerFactory.name} based on high material compatibility and geographical proximity.`;
        try {
          const explanationRes = await aiClient.explainMatch({
            sellerMaterial: listing.material_type,
            sellerFactoryName: sellerFactory.name,
            buyerFactoryName: buyerFactory.name,
            buyerNeedsMaterial: buyerFactory.production_schedule?.needs_material_type || listing.material_type,
            compatibilityScore: Math.round(ranked.compatibilityScore),
            distanceKm: Number(Number(ranked.distanceKm || 0).toFixed(1)),
            confidenceScore: Math.round((listing.confidence_score || 0.95) * 100),
            predictedSurplusDate: listing.predicted_surplus_date ? new Date(listing.predicted_surplus_date).toISOString().split('T')[0] : 'soon'
          });
          if (explanationRes && explanationRes.explanation) {
            aiExplanation = explanationRes.explanation;
          }
        } catch (err) {
          console.warn('[cron] AI explanation generation failed, using fallback:', err.message);
        }

        const match = await Match.create({
          listingId: listing.id,
          buyerFactoryId: buyerFactory.id,
          compatibilityScore: ranked.compatibilityScore / 100, // convert 0-100 score back to 0-1 float for DB compatibility_score
          aiExplanation,
        });

        // Signed token lets the buyer confirm/decline straight from the email
        // without being logged in — the link itself carries the authorization.
        const actionToken = signMatchActionToken({ matchId: match.id, buyerFactoryId: buyerFactory.id });

        await sendSurplusAlert({
          buyerEmail: buyerUser.email,
          listing,
          matchId: match.id,
          acceptUrl: `${APP_URL}/api/matches/${match.id}/confirm?token=${actionToken}`,
          declineUrl: `${APP_URL}/api/matches/${match.id}/decline?token=${actionToken}`,
        });

        // Calculate hours remaining until the predicted surplus occurs
        let hoursRemaining = 'unknown time';
        if (listing.predicted_surplus_date) {
          const diffMs = new Date(listing.predicted_surplus_date) - new Date();
          const hours = Math.round(diffMs / (1000 * 60 * 60));
          if (hours > 0) {
            hoursRemaining = `${hours} hours`;
          }
        }

        // Create an in-app notification for the buyer
        await Notification.create({
          userId: buyerUser.id,
          title: `Upcoming Surplus Warning: ${listing.material_type}`,
          message: `AI Prediction: A surplus of ${Number(listing.quantity_kg).toLocaleString()} kg of ${listing.material_type} is expected from ${sellerFactory.name} in ${hoursRemaining}. Compatibility: ${Math.round(ranked.compatibilityScore)}%.`,
          type: 'surplus_alert',
          linkUrl: 'factory-profile.html'
        });

        console.log(`[cron] Alerted buyer ${buyerUser.email} for listing ${listing.id} (match ${match.id})`);
      }
    }
  } catch (err) {
    console.error('[cron] surplusAlert job failed:', err);
  }
}

function startSurplusAlertCron() {
  // Runs every 6 hours, matching the architecture described in the pitch doc.
  cron.schedule('0 */6 * * *', runSurplusAlertCheck);
  console.log('[cron] Surplus alert job scheduled (every 6 hours).');
}

module.exports = { startSurplusAlertCron, runSurplusAlertCheck };
