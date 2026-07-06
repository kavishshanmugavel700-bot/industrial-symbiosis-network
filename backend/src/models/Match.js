const { query } = require('../config/db');

const Match = {
  async create({ listingId, buyerFactoryId, compatibilityScore }) {
    const { rows } = await query(
      `INSERT INTO matches (listing_id, buyer_factory_id, compatibility_score)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [listingId, buyerFactoryId, compatibilityScore || null]
    );
    return rows[0];
  },

  async findById(id) {
    const { rows } = await query(`SELECT * FROM matches WHERE id = $1`, [id]);
    return rows[0] || null;
  },

  // Used to prevent duplicate matches when a buyer (or the cron job) retries
  // against a listing that already has a pending match for that buyer.
  async findPendingByListingAndBuyer(listingId, buyerFactoryId) {
    const { rows } = await query(
      `SELECT * FROM matches WHERE listing_id = $1 AND buyer_factory_id = $2 AND status = 'pending' LIMIT 1`,
      [listingId, buyerFactoryId]
    );
    return rows[0] || null;
  },

  async listForFactory(factoryId) {
    const { rows } = await query(
      `SELECT m.*, l.material_type, l.quantity_kg, l.factory_id AS seller_factory_id
       FROM matches m
       JOIN listings l ON l.id = m.listing_id
       WHERE m.buyer_factory_id = $1 OR l.factory_id = $1
       ORDER BY m.id DESC`,
      [factoryId]
    );
    return rows;
  },

  async confirm(id) {
    const { rows } = await query(
      `UPDATE matches SET status = 'confirmed', confirmed_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    return rows[0];
  },

  async decline(id) {
    const { rows } = await query(
      `UPDATE matches SET status = 'declined' WHERE id = $1 RETURNING *`,
      [id]
    );
    return rows[0];
  },
};

module.exports = Match;
