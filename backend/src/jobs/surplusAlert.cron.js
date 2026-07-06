const cron = require('node-cron');
const Listing = require('../models/Listing');
const Factory = require('../models/Factory');
const Match = require('../models/Match');
const User = require('../models/User');
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

      let rankedBuyers = [];
      try {
        rankedBuyers = await aiClient.rankBuyers({
          listingId: listing.id,
          materialType: listing.material_type,
          sellerLat: sellerFactory?.latitude,
          sellerLon: sellerFactory?.longitude,
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

        const match = await Match.create({
          listingId: listing.id,
          buyerFactoryId: buyerFactory.id,
          compatibilityScore: ranked.compatibilityScore,
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
