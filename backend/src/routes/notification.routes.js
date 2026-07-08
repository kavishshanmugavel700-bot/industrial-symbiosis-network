const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const authMiddleware = require('../middleware/auth.middleware');

router.use(authMiddleware);

// Get list of notifications and count of unread notifications
router.get('/', async (req, res) => {
  try {
    const notifications = await Notification.listForUser(req.user.id);
    const unreadCount = await Notification.getUnreadCount(req.user.id);
    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('[notification.list]', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark all as read (MUST be declared before /:id/read to prevent route matching conflict)
router.put('/read-all', async (req, res) => {
  try {
    await Notification.markAllAsRead(req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[notification.readAll]', err);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// Mark notification as read
router.put('/:id/read', async (req, res) => {
  try {
    const notification = await Notification.markAsRead(req.params.id, req.user.id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found or unauthorized' });
    }
    res.json({ notification });
  } catch (err) {
    console.error('[notification.read]', err);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

module.exports = router;
