const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

// Simple helper so controllers don't need to import pg directly
const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
