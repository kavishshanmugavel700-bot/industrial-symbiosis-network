const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth.routes');
const factoryRoutes = require('./routes/factory.routes');
const marketplaceRoutes = require('./routes/marketplace.routes');
const matchRoutes = require('./routes/match.routes');
const certificateRoutes = require('./routes/certificate.routes');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Basic abuse protection for a public hackathon demo deploy. Generous enough
// not to interfere with normal use/testing.
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'industrial-symbiosis-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/factories', factoryRoutes);
app.use('/api/listings', marketplaceRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/certificates', certificateRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
