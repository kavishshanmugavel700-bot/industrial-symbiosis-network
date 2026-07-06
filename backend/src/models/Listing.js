const { query } = require('../config/db');

const Listing = {
  async create({ factoryId, materialType, quantityKg, predictedSurplusDate, confidenceScore }) {
    const { rows } = await query(
      `INSERT INTO listings (factory_id, material_type, quantity_kg, predicted_surplus_date, confidence_score)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [factoryId, materialType, quantityKg, predictedSurplusDate || null, confidenceScore || null]
    );
    return rows[0];
  },

  async listOpen({ materialType, minQuantity } = {}) {
    const clauses = [`status = 'open'`];
    const params = [];
    if (materialType) {
      params.push(materialType);
      clauses.push(`material_type = $${params.length}`);
    }
    if (minQuantity) {
      params.push(minQuantity);
      clauses.push(`quantity_kg >= $${params.length}`);
    }
    const { rows } = await query(
      `SELECT l.*, f.name AS factory_name, f.latitude, f.longitude, f.industry_type
       FROM listings l
       JOIN factories f ON f.id = l.factory_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY l.created_at DESC`,
      params
    );
    return rows;
  },

  async findById(id) {
    const { rows } = await query(`SELECT * FROM listings WHERE id = $1`, [id]);
    return rows[0] || null;
  },

  async findUpcomingSurplus(hoursAhead = 72) {
    const { rows } = await query(
      `SELECT l.*, f.name AS factory_name, f.latitude, f.longitude
       FROM listings l
       JOIN factories f ON f.id = l.factory_id
       WHERE l.status = 'open'
         AND l.predicted_surplus_date IS NOT NULL
         AND l.predicted_surplus_date <= NOW() + ($1 || ' hours')::interval
         AND l.predicted_surplus_date >= NOW()`,
      [hoursAhead]
    );
    return rows;
  },

  async updateStatus(id, status) {
    const { rows } = await query(
      `UPDATE listings SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status]
    );
    return rows[0];
  },
};

module.exports = Listing;
