const { query } = require('../config/db');

const Notification = {
  async create({ userId, title, message, type, linkUrl }) {
    const { rows } = await query(
      `INSERT INTO notifications (user_id, title, message, type, link_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, title, message, type || 'info', linkUrl || null]
    );
    return rows[0];
  },

  async listForUser(userId) {
    const { rows } = await query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  async markAsRead(id, userId) {
    const { rows } = await query(
      `UPDATE notifications 
       SET is_read = TRUE 
       WHERE id = $1 AND user_id = $2 
       RETURNING *`,
      [id, userId]
    );
    return rows[0];
  },

  async markAllAsRead(userId) {
    const { rows } = await query(
      `UPDATE notifications 
       SET is_read = TRUE 
       WHERE user_id = $1 
       RETURNING *`,
      [userId]
    );
    return rows;
  },

  async getUnreadCount(userId) {
    const { rows } = await query(
      `SELECT COUNT(*) AS count 
       FROM notifications 
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );
    return Number(rows[0].count);
  }
};

module.exports = Notification;
