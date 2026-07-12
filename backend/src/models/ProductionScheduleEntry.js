const { query } = require('../config/db');

/**
 * Database model for production_schedule_entries.
 * Stores both PDF-extracted ('pdf') and AI-predicted ('predicted') production slots.
 */
const ProductionScheduleEntry = {
  /**
   * Bulk-insert an array of schedule entry objects for a factory.
   * Returns the inserted rows.
   */
  async bulkInsert(entries) {
    if (!entries || entries.length === 0) return [];
    const inserted = [];
    for (const entry of entries) {
      const { rows } = await query(
        `INSERT INTO production_schedule_entries
           (factory_id, material_type, quantity_kg, production_date, source)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [entry.factoryId, entry.materialType, entry.quantityKg, entry.productionDate, entry.source]
      );
      inserted.push(rows[0]);
    }
    return inserted;
  },

  /**
   * Return all factories that have at least one open entry for a given material.
   * Includes factory metadata for ranking.
   */
  async findFactoriesByMaterial(materialType) {
    const { rows } = await query(
      `SELECT DISTINCT ON (f.id)
              f.id           AS factory_id,
              f.name,
              f.industry_type,
              f.latitude,
              f.longitude,
              f.trust_score,
              $1             AS needs_material_type
         FROM production_schedule_entries pse
         JOIN factories f ON f.id = pse.factory_id
        WHERE pse.material_type ILIKE $1
          AND pse.status = 'open'
          AND f.latitude  IS NOT NULL
          AND f.longitude IS NOT NULL`,
      [materialType]
    );
    return rows;
  },

  /**
   * Return all open slots for a single factory, optionally filtered by material.
   * Sorted ascending by production_date.
   */
  async findByFactory(factoryId, materialType) {
    const params = [factoryId];
    let whereExtra = '';
    if (materialType) {
      params.push(materialType);
      whereExtra = `AND material_type ILIKE $${params.length}`;
    }
    const { rows } = await query(
      `SELECT * FROM production_schedule_entries
        WHERE factory_id = $1
          ${whereExtra}
        ORDER BY production_date ASC`,
      params
    );
    return rows;
  },

  /**
   * Find a single entry by its ID.
   */
  async findById(id) {
    const { rows } = await query(
      `SELECT * FROM production_schedule_entries WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Mark an entry as purchased and record the buyer's factory ID.
   */
  async markPurchased(id, buyerFactoryId) {
    const { rows } = await query(
      `UPDATE production_schedule_entries
          SET status = 'purchased', buyer_factory_id = $2
        WHERE id = $1
       RETURNING *`,
      [id, buyerFactoryId]
    );
    return rows[0] || null;
  },

  /**
   * Delete all schedule entries for a factory (called before re-upload).
   */
  async deleteByFactory(factoryId) {
    await query(
      `DELETE FROM production_schedule_entries WHERE factory_id = $1`,
      [factoryId]
    );
  },
};

module.exports = ProductionScheduleEntry;
