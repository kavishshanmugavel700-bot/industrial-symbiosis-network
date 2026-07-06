require('dotenv').config();

const required = ['DATABASE_URL', 'JWT_SECRET'];
const nodeEnv = process.env.NODE_ENV || 'development';
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  if (nodeEnv === 'production') {
    console.error(`[env] Missing required environment variable(s) in production: ${missing.join(', ')}`);
    process.exit(1);
  }
  missing.forEach((key) => console.warn(`[env] Warning: ${key} is not set in .env`));
}

module.exports = {
  port: process.env.PORT || 4000,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  gmailUser: process.env.GMAIL_USER,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:5000',
  taiwanOpenDataApi: process.env.TAIWAN_OPEN_DATA_API || 'https://data.gov.tw',
  nodeEnv,
};
