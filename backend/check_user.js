require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const uRes = await pool.query("SELECT id, email, role FROM users WHERE email = 'q@gmail.com'");
  console.log('User:', uRes.rows[0]);
  if (uRes.rows[0]) {
    const fRes = await pool.query("SELECT id, name, user_id FROM factories WHERE user_id = $1", [uRes.rows[0].id]);
    console.log('Associated Factory:', fRes.rows[0]);
  }
}

check().then(() => pool.end()).catch(err => { console.error(err); pool.end(); });
