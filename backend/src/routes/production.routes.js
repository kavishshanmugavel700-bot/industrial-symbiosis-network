const express  = require('express');
const multer   = require('multer');
const router   = express.Router();
const productionController = require('../controllers/production.controller');
const authMiddleware       = require('../middleware/auth.middleware');
const roleCheck            = require('../middleware/roleCheck.middleware');

// Store uploaded PDFs temporarily in /uploads; cleaned up by the controller.
const upload = multer({ dest: 'uploads/' });

// POST /api/listings/upload-schedule — seller uploads a PDF production schedule
router.post(
  '/upload-schedule',
  authMiddleware,
  roleCheck('factory', 'admin'),
  upload.single('file'),
  productionController.uploadSchedule
);

// GET /api/listings/search?material=<name> — buyer searches for factories by material
// IMPORTANT: must be declared before /:id to avoid Express treating 'search' as an id param
router.get(
  '/search',
  authMiddleware,
  productionController.searchSchedules
);

// POST /api/listings/purchase — buyer reserves a slot and receives a PDF confirmation
router.post(
  '/purchase',
  authMiddleware,
  productionController.purchaseSlot
);

module.exports = router;
