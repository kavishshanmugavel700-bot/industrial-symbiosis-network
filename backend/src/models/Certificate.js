const { query } = require('../config/db');

const Certificate = {
  async create({ matchId, co2AvoidedKg, pdfUrl }) {
    const { rows } = await query(
      `INSERT INTO certificates (match_id, co2_avoided_kg, pdf_url)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [matchId, co2AvoidedKg, pdfUrl]
    );
    return rows[0];
  },

  async findByMatchId(matchId) {
    const { rows } = await query(`SELECT * FROM certificates WHERE match_id = $1`, [matchId]);
    return rows[0] || null;
  },

  async listAll() {
    const { rows } = await query(`SELECT * FROM certificates ORDER BY issued_at DESC`);
    return rows;
  },

  async totalCo2Avoided() {
    const { rows } = await query(`SELECT COALESCE(SUM(co2_avoided_kg), 0) AS total FROM certificates`);
    return Number(rows[0].total);
  },
};

module.exports = Certificate;
