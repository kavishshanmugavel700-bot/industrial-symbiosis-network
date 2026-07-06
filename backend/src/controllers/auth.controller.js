const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Factory = require('../models/Factory');
const env = require('../config/env');

const SALT_ROUNDS = 10;

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

async function register(req, res) {
  try {
    const { email, password, role, factoryName, industryType, latitude, longitude } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password, and role are required' });
    }
    if (!['factory', 'buyer', 'admin'].includes(role)) {
      return res.status(400).json({ error: "role must be one of 'factory', 'buyer', 'admin'" });
    }

    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({ email, passwordHash, role });

    // Factory & buyer accounts both get a "factory" profile row (buyers are
    // just factories that primarily consume listings) so matching/geo logic
    // can treat them uniformly.
    let factory = null;
    if (role === 'factory' || role === 'buyer') {
      factory = await Factory.create({
        userId: user.id,
        name: factoryName || email.split('@')[0],
        industryType: industryType || null,
        latitude: latitude || null,
        longitude: longitude || null,
        productionSchedule: {},
      });
    }

    const token = signToken(user);
    return res.status(201).json({ token, user, factory });
  } catch (err) {
    console.error('[auth.register]', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    const factory = await Factory.findByUserId(user.id);
    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
      factory,
    });
  } catch (err) {
    console.error('[auth.login]', err);
    return res.status(500).json({ error: 'Login failed' });
  }
}

async function me(req, res) {
  try {
    const user = await User.findById(req.user.id);
    const factory = await Factory.findByUserId(req.user.id);
    return res.json({ user, factory });
  } catch (err) {
    console.error('[auth.me]', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

module.exports = { register, login, me };
