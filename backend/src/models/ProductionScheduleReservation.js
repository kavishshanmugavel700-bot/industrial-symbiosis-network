const { query } = require('../config/db');

const ProductionScheduleReservation = {
  /**
   * Create a new pending reservation request.
   */
  async create({ entryId, buyerFactoryId, aiExplanation }) {
    const { rows } = await query(
      `INSERT INTO production_schedule_reservations (entry_id, buyer_factory_id, ai_explanation, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [entryId, buyerFactoryId, aiExplanation]
    );
    return rows[0];
  },

  /**
   * Find a reservation by its ID, with entry and factory details.
   */
  async findById(id) {
    const { rows } = await query(
      `SELECT r.*,
              e.material_type,
              e.quantity_kg,
              e.production_date,
              e.source,
              e.factory_id AS seller_factory_id,
              sf.name AS seller_name,
              bf.name AS buyer_name
         FROM production_schedule_reservations r
         JOIN production_schedule_entries e ON e.id = r.entry_id
         JOIN factories sf ON sf.id = e.factory_id
         JOIN factories bf ON bf.id = r.buyer_factory_id
        WHERE r.id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Check if a buyer has already requested a slot.
   */
  async findDuplicate(entryId, buyerFactoryId) {
    const { rows } = await query(
      `SELECT * FROM production_schedule_reservations
        WHERE entry_id = $1 AND buyer_factory_id = $2`,
      [entryId, buyerFactoryId]
    );
    return rows[0] || null;
  },

  /**
   * Return all incoming requests for slots owned by a seller.
   */
  async findIncomingBySeller(sellerFactoryId) {
    const { rows } = await query(
      `SELECT r.id AS reservation_id,
              r.status AS reservation_status,
              r.ai_explanation,
              r.created_at,
              e.id AS slot_id,
              e.material_type,
              e.quantity_kg,
              e.production_date,
              e.source AS slot_source,
              bf.id AS buyer_factory_id,
              bf.name AS buyer_name,
              bf.industry_type AS buyer_industry,
              bf.latitude AS buyer_latitude,
              bf.longitude AS buyer_longitude,
              bf.trust_score AS buyer_trust
         FROM production_schedule_reservations r
         JOIN production_schedule_entries e ON e.id = r.entry_id
         JOIN factories bf ON bf.id = r.buyer_factory_id
        WHERE e.factory_id = $1
        ORDER BY r.created_at DESC`,
      [sellerFactoryId]
    );
    return rows;
  },

  /**
   * Return all outgoing requests made by a buyer.
   */
  async findOutgoingByBuyer(buyerFactoryId) {
    const { rows } = await query(
      `SELECT r.id AS reservation_id,
              r.status AS reservation_status,
              r.created_at,
              e.id AS slot_id,
              e.material_type,
              e.quantity_kg,
              e.production_date,
              e.source AS slot_source,
              sf.id AS seller_factory_id,
              sf.name AS seller_name
         FROM production_schedule_reservations r
         JOIN production_schedule_entries e ON e.id = r.entry_id
         JOIN factories sf ON sf.id = e.factory_id
        WHERE r.buyer_factory_id = $1
        ORDER BY e.production_date ASC`,
      [buyerFactoryId]
    );
    return rows;
  },

  /**
   * Approve a single request, reject all other competing requests for that slot.
   */
  async approve(reservationId, entryId) {
    // 1. Approve chosen request
    await query(
      `UPDATE production_schedule_reservations SET status = 'approved' WHERE id = $1`,
      [reservationId]
    );

    // 2. Reject other requests for this slot
    await query(
      `UPDATE production_schedule_reservations
          SET status = 'rejected'
        WHERE entry_id = $1 AND id <> $2`,
      [entryId, reservationId]
    );
  },
};

module.exports = ProductionScheduleReservation;
