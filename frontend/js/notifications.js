/**
 * Toast notification helpers for the ISIN UI.
 * Creates elegant, fading toast banners in the top right.
 */
const notifications = {
  /**
   * Generates a toast notification.
   * @param {string} message - The alert text to show
   * @param {'success'|'error'|'info'} type - Category of toast
   */
  show(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // Choose icon depending on type
    let svgIcon = '';
    if (type === 'success') {
      svgIcon = `<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor" style="color: var(--clr-success);"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>`;
    } else if (type === 'error') {
      svgIcon = `<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor" style="color: var(--clr-error);"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`;
    } else {
      svgIcon = `<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor" style="color: var(--clr-accent);"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zm-1 9a1 1 0 01-1-1v-4a1 1 0 112 0v4a1 1 0 01-1 1z" clip-rule="evenodd"/></svg>`;
    }

    toast.innerHTML = `
      ${svgIcon}
      <div class="toast-message">${message}</div>
      <button class="toast-close">&times;</button>
    `;

    container.appendChild(toast);

    // Trigger reflow/animation
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    const closeToast = () => {
      toast.classList.remove('show');
      toast.addEventListener('transitionend', () => {
        toast.remove();
      });
    };

    // Close on clicking X
    toast.querySelector('.toast-close').addEventListener('click', closeToast);

    // Auto close after 4.5 seconds
    setTimeout(closeToast, 4500);
  },

  showSuccess(message) {
    this.show(message, 'success');
  },

  showError(message) {
    this.show(message, 'error');
  },

  showInfo(message) {
    this.show(message, 'info');
  }
};

window.notifications = notifications;
