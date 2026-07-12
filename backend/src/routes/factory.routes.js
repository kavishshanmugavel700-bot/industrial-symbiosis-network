const express  = require('express');
const router   = express.Router();
const Factory  = require('../models/Factory');
const authMiddleware        = require('../middleware/auth.middleware');
const productionController  = require('../controllers/production.controller');

// Public: list all factories (used by map/dashboard)
router.get('/', async (req, res) => {
  try {
    const factories = await Factory.listAll();
    res.json({ factories });
  } catch (err) {
    console.error('[factory.list]', err);
    res.status(500).json({ error: 'Failed to fetch factories' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const factory = await Factory.findByUserId(req.user.id);
    if (!factory) return res.status(404).json({ error: 'No factory profile found' });
    res.json({ factory });
  } catch (err) {
    console.error('[factory.me]', err);
    res.status(500).json({ error: 'Failed to fetch factory profile' });
  }
});

router.put('/me/schedule', authMiddleware, async (req, res) => {
  try {
    const factory = await Factory.findByUserId(req.user.id);
    if (!factory) return res.status(404).json({ error: 'No factory profile found' });
    const updated = await Factory.updateProductionSchedule(factory.id, req.body.productionSchedule || {});
    res.json({ factory: updated });
  } catch (err) {
    console.error('[factory.updateSchedule]', err);
    res.status(500).json({ error: 'Failed to update production schedule' });
  }
});

// GET /api/factories/:id/schedule?material=<name>
// Returns a factory's production schedule slots (PDF-confirmed + AI-predicted)
router.get('/:id/schedule', authMiddleware, productionController.getFactorySchedule);

module.exports = router;

