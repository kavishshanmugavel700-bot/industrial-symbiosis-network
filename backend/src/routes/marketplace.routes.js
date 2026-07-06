const express = require('express');
const router = express.Router();
const marketplaceController = require('../controllers/marketplace.controller');
const authMiddleware = require('../middleware/auth.middleware');
const roleCheck = require('../middleware/roleCheck.middleware');

router.get('/', marketplaceController.browseListings); // public browse
router.get('/:id', marketplaceController.getListing);
router.post('/', authMiddleware, roleCheck('factory', 'admin'), marketplaceController.createListing);
router.get('/:id/rank-buyers', authMiddleware, marketplaceController.rankBuyersForListing);

module.exports = router;
