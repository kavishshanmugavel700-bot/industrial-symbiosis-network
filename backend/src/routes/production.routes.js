const express  = require('express');
const multer   = require('multer');
const router   = express.Router();
const productionController = require('../controllers/production.controller');
const authMiddleware       = require('../middleware/auth.middleware');
const roleCheck            = require('../middleware/roleCheck.middleware');

const upload = multer({ dest: 'uploads/' });

// POST /api/listings/upload-schedule — seller uploads a PDF production schedule
router.post(
  '/upload-schedule',
  authMiddleware,
  roleCheck('factory', 'buyer', 'admin'), // support both unified roles
  upload.single('file'),
  productionController.uploadSchedule
);

// GET /api/listings/search?material=<name> — buyer searches for factories by material
router.get(
  '/search',
  authMiddleware,
  productionController.searchSchedules
);

// POST /api/listings/reserve — buyer requests reservation for a slot
router.post(
  '/reserve',
  authMiddleware,
  productionController.requestSlotReservation
);

// GET /api/listings/reservations/incoming — seller views incoming slot booking requests
router.get(
  '/reservations/incoming',
  authMiddleware,
  productionController.getIncomingRequests
);

// GET /api/listings/reservations/outgoing — buyer views their requested reservations
router.get(
  '/reservations/outgoing',
  authMiddleware,
  productionController.getOutgoingRequests
);

// POST /api/listings/reservations/:id/approve — seller approves a slot booking request
router.post(
  '/reservations/:id/approve',
  authMiddleware,
  productionController.approveReservation
);

// GET /api/listings/reservations/:id/receipt — download the PDF receipt
router.get(
  '/reservations/:id/receipt',
  authMiddleware,
  productionController.downloadReceipt
);

module.exports = router;
