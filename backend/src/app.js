const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth.routes');
const factoryRoutes = require('./routes/factory.routes');
const productionRoutes = require('./routes/production.routes');
const marketplaceRoutes = require('./routes/marketplace.routes');
const matchRoutes = require('./routes/match.routes');
const certificateRoutes = require('./routes/certificate.routes');
const notificationRoutes = require('./routes/notification.routes');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Basic abuse protection for a public hackathon demo deploy. Generous enough
// not to interfere with normal use/testing.
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

app.get('/health', (req, res) => {
  const env = require('./config/env');
  res.json({
    status: 'ok',
    service: 'industrial-symbiosis-backend',
    aiServiceUrl: env.aiServiceUrl,
    nodeEnv: env.nodeEnv
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/factories', factoryRoutes);
// Production routes must be mounted BEFORE marketplace so /search & /purchase
// are not consumed by marketplace's /:id wildcard.
app.use('/api/listings', productionRoutes);
app.use('/api/listings', marketplaceRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/notifications', notificationRoutes);

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
