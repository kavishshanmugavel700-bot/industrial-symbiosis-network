/**
 * Navbar In-App Notifications Controller for ISIN.
 * Toggles dropdown, fetches unread alerts, and handles reading states.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize notifications if user is logged in
  if (!window.auth || !window.auth.isAuthenticated()) return;

  const bellBtn = document.getElementById('notification-bell-btn');
  const dropdown = document.getElementById('notification-dropdown-menu');
  const badge = document.getElementById('notification-badge-count');
  const listContainer = document.getElementById('notification-dropdown-list');
  const markAllBtn = document.getElementById('mark-all-read-action');

  if (!bellBtn || !dropdown) return;

  // Toggle Dropdown
  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('show');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
      dropdown.classList.remove('show');
    }
  });

  // Load and Render Notifications
  async function loadNotifications() {
    try {
      const data = await window.apiFetch('/api/notifications');
      const { notifications: items, unreadCount } = data;

      // Update badge
      if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }

      // Render items
      if (items.length === 0) {
        listContainer.innerHTML = `
          <div class="notification-empty-state">
            <svg style="width: 32px; height: 32px; opacity: 0.5;" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/>
            </svg>
            <p style="font-size: 0.85rem; font-weight: 600; margin-top: 0.5rem; color: var(--clr-text-main);">No notifications yet</p>
            <span style="font-size: 0.75rem; color: var(--clr-text-muted);">You're all caught up.</span>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = '';
      items.forEach(item => {
        const timeAgo = formatTimeAgo(new Date(item.created_at));
        const itemClass = item.is_read ? 'notification-item' : 'notification-item unread';
        
        let iconHtml = `
          <svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 111.063.852l-.708 2.836a.75.75 0 001.063.852l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/>
          </svg>
        `;
        if (item.type === 'surplus_alert') {
          iconHtml = `
            <svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
          `;
        }

        const notificationEl = document.createElement('div');
        notificationEl.className = itemClass;
        notificationEl.innerHTML = `
          <div class="notification-icon-wrapper">
            ${iconHtml}
          </div>
          <div class="notification-item-content">
            <div class="notification-item-title">${item.title}</div>
            <div class="notification-item-message">${item.message}</div>
            <div class="notification-item-time">${timeAgo}</div>
          </div>
        `;

        notificationEl.addEventListener('click', async (e) => {
          e.preventDefault();
          // Mark as read
          if (!item.is_read) {
            try {
              await window.apiFetch(`/api/notifications/${item.id}/read`, { method: 'PUT' });
            } catch (err) {
              console.error('Failed to mark read:', err);
            }
          }
          // Redirect if linkUrl exists
          if (item.link_url) {
            window.location.href = item.link_url;
          } else {
            loadNotifications();
          }
        });

        listContainer.appendChild(notificationEl);
      });

    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  }

  // Handle Mark All As Read
  if (markAllBtn) {
    markAllBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await window.apiFetch('/api/notifications/read-all', { method: 'PUT' });
        if (window.notifications) {
          window.notifications.showSuccess('All notifications marked as read.');
        }
        loadNotifications();
      } catch (err) {
        if (window.notifications) {
          window.notifications.showError('Failed to mark all notifications as read.');
        }
      }
    });
  }

  // Initial load
  loadNotifications();

  // Poll every 30 seconds for real-time updates
  setInterval(loadNotifications, 30000);

  // Time Formatter helper
  function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = Math.floor(seconds / 31536000);

    if (interval >= 1) return interval + 'y ago';
    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return interval + 'mo ago';
    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return interval + 'd ago';
    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return interval + 'h ago';
    interval = Math.floor(seconds / 60);
    if (interval >= 1) return interval + 'm ago';
    return 'just now';
  }
});
