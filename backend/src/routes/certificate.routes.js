const express = require('express');
const router = express.Router();
const Certificate = require('../models/Certificate');
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

module.exports = router;
