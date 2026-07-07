const { query } = require('../config/db');

const Factory = {
  async create({ userId, name, industryType, latitude, longitude, productionSchedule }) {
    const { rows } = await query(
      `INSERT INTO factories (user_id, name, industry_type, latitude, longitude, production_schedule)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, name, industryType, latitude, longitude, productionSchedule || {}]
    );
    return rows[0];
  },

  async findByUserId(userId) {
    const { rows } = await query(`SELECT * FROM factories WHERE user_id = $1`, [userId]);
    return rows[0] || null;
  },

  async findById(id) {
    const { rows } = await query(`SELECT * FROM factories WHERE id = $1`, [id]);
    return rows[0] || null;
  },

  async listAll() {
    const { rows } = await query(`SELECT * FROM factories ORDER BY created_at DESC`);
    return rows;
  },

  async updateTrustScore(id, delta) {
    const { rows } = await query(
      `UPDATE factories SET trust_score = trust_score + $2 WHERE id = $1 RETURNING *`,
      [id, delta]
    );
    return rows[0];
  },

  async updateProductionSchedule(id, productionSchedule) {
    const { rows } = await query(
      `UPDATE factories SET production_schedule = $2 WHERE id = $1 RETURNING *`,
      [id, productionSchedule]
    );
    return rows[0];
  },

  /**
   * Find all factories whose production_schedule JSONB field contains a
   * 'needs_material_type' key matching the given value.
   *
   * This is used by the marketplace controller to build the buyerFactories
   * list before calling the AI ranking service.
   *
   * @param {string} needsMaterialType - The material type the buyer needs.
   * @returns {Promise<Array>} Array of factory rows (may be empty).
   */
  async findByNeedsMaterial(needsMaterialType) {
    const { rows } = await query(
      `SELECT id AS factory_id,
              name,
              industry_type,
              latitude,
              longitude,
              trust_score,
              production_schedule->>'needs_material_type' AS needs_material_type
       FROM factories
       WHERE production_schedule->>'needs_material_type' = $1
         AND latitude  IS NOT NULL
         AND longitude IS NOT NULL`,
      [needsMaterialType]
    );
    return rows;
  },
};


module.exports = Factory;
