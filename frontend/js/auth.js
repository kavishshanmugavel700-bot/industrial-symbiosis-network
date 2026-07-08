/**
 * Authentication and Session Management for ISIN.
 */
const auth = {
  getToken() {
    return localStorage.getItem('isin_token');
  },

  getUser() {
    const userStr = localStorage.getItem('isin_user');
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
    } catch (e) {
      return null;
    }
  },

  getFactory() {
    const factoryStr = localStorage.getItem('isin_factory');
    if (!factoryStr) return null;
    try {
      return JSON.parse(factoryStr);
    } catch (e) {
      return null;
    }
  },

  setSession(token, user, factory) {
    localStorage.setItem('isin_token', token);
    localStorage.setItem('isin_user', JSON.stringify(user));
    if (factory) {
      localStorage.setItem('isin_factory', JSON.stringify(factory));
    } else {
      localStorage.removeItem('isin_factory');
    }
  },

  logout() {
    localStorage.removeItem('isin_token');
    localStorage.removeItem('isin_user');
    localStorage.removeItem('isin_factory');
    if (window.notifications) {
      window.notifications.showInfo('Logged out successfully.');
    }
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 1000);
  },

  isAuthenticated() {
    return !!this.getToken();
  },

  isAdmin() {
    const user = this.getUser();
    return user && user.role === 'admin';
  },

  /**
   * Guards a page to ensure only authenticated users can access it.
   */
  guardRoute() {
    const path = window.location.pathname;
    const isProfilePage = path.includes('factory-profile.html');
    const isDashboardPage = path.includes('gov-dashboard.html');

    if ((isProfilePage || isDashboardPage) && !this.isAuthenticated()) {
      window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.href);
      return false;
    }

    if (isDashboardPage && !this.isAdmin()) {
      // Soft-guard is handled inside the page UI by displaying a friendly message
      console.warn('Access restricted to Admins on this route.');
    }
    return true;
  },

  /**
   * Refreshes the top-level navigation bar links and actions dynamically based on login state.
   */
  updateNavbar() {
    const navAuth = document.querySelector('.nav-auth');
    if (!navAuth) return;

    const user = this.getUser();
    if (user) {
      let profileLink = '';
      if (user.role === 'factory' || user.role === 'buyer') {
        profileLink = `<li><a href="factory-profile.html">My Profile</a></li>`;
      }
      
      const dashboardLink = `<li><a href="gov-dashboard.html">Gov Dashboard</a></li>`;
      
      // Inject standard navigation items if missing
      const navLinks = document.querySelector('.nav-links');
      if (navLinks) {
        // Keep Home and Marketplace, rewrite the rest dynamically
        navLinks.innerHTML = `
          <li><a href="index.html">Home</a></li>
          <li><a href="marketplace.html">Marketplace</a></li>
          ${profileLink}
          ${user.role === 'admin' ? dashboardLink : ''}
        `;
        
        // Highlight active page
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const links = navLinks.querySelectorAll('a');
        links.forEach(link => {
          if (link.getAttribute('href') === currentPage) {
            link.parentElement.classList.add('active');
          } else {
            link.parentElement.classList.remove('active');
          }
        });
      }

      navAuth.innerHTML = `
        <div class="user-badge" style="display: flex; align-items: center; gap: 0.8rem;">
          <span style="font-size: 0.9rem; font-weight: 500; color: var(--clr-text-main);">
            ${user.email} (${user.role})
          </span>
          <button id="logout-btn" class="btn btn-secondary" style="padding: 0.4rem 1rem; font-size: 0.85rem;">Logout</button>
        </div>
      `;

      document.getElementById('logout-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        this.logout();
      });
    } else {
      navAuth.innerHTML = `
        <a href="login.html" class="btn btn-secondary" style="padding: 0.5rem 1.2rem; font-size: 0.9rem;">Login</a>
        <a href="register.html" class="btn btn-primary" style="padding: 0.5rem 1.2rem; font-size: 0.9rem;">Register</a>
      `;
    }
  }
};

// Auto-run guards and navbar setup
document.addEventListener('DOMContentLoaded', () => {
  auth.guardRoute();
  auth.updateNavbar();
});

window.auth = auth;
