const { query } = require('../config/db');

const User = {
  async create({ email, passwordHash, role }) {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, email, role, created_at`,
      [email, passwordHash, role]
    );
    return rows[0];
  },

  async findByEmail(email) {
    const { rows } = await query(`SELECT * FROM users WHERE email = $1`, [email]);
    return rows[0] || null;
  },

  async findById(id) {
    const { rows } = await query(
      `SELECT id, email, role, created_at FROM users WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },
};

module.exports = User;
