const express = require('express');
const router = express.Router();
const matchController = require('../controllers/match.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Email action-links: unauthenticated (token in query string instead of a
// Bearer header, since a browser click can't carry one). These MUST be
// registered before `router.use(authMiddleware)` below, since that applies
// to every route registered after it in this router.
router.get('/:id/confirm', matchController.confirmMatchViaEmailLink);
router.get('/:id/decline', matchController.declineMatchViaEmailLink);

router.use(authMiddleware);

router.post('/', matchController.createMatch);
router.get('/mine', matchController.listMyMatches);
router.post('/:id/confirm', matchController.confirmMatch);
router.post('/:id/decline', matchController.declineMatch);

module.exports = router;
