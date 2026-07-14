require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const { purchaseSlot } = require('./src/controllers/production.controller');

async function test() {
  // Find an open production slot
  const slotRes = await pool.query("SELECT id, factory_id, material_type FROM production_schedule_entries WHERE status = 'open' LIMIT 1");
  const slot = slotRes.rows[0];
  if (!slot) {
    console.log('No open slots found to test.');
    return;
  }
  console.log('Found open slot:', slot);

  // Mock Request for buyer (user_id = 4, factory_id = 4)
  const req = {
    body: { entryId: slot.id },
    user: { id: 4 } // User ID for q@gmail.com
  };

  // Mock Response
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(buffer) {
      console.log('Success! Received PDF Buffer length:', buffer.length);
      console.log('Headers:', this.headers);
    },
    status(code) {
      console.log('Status code set to:', code);
      return this;
    },
    json(data) {
      console.log('Error Response JSON:', data);
    }
  };

  await purchaseSlot(req, res);
}

test().then(() => pool.end()).catch(err => { console.error(err); pool.end(); });
