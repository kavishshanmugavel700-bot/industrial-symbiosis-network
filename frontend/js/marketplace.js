/**
 * Marketplace listings and operations handling for ISIN.
 */
document.addEventListener('DOMContentLoaded', () => {
  const listingsGrid = document.getElementById('listings-grid');
  const filterForm = document.getElementById('filter-form');
  const resetFiltersBtn = document.getElementById('reset-filters-btn');
  const createListingContainer = document.getElementById('create-listing-btn-container');

  // Modal elements
  const modal = document.getElementById('create-modal');
  const openModalBtn = document.getElementById('open-modal-btn');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const createForm = document.getElementById('create-listing-form');

  // Show "Create Listing" button to Factory or Admin users
  const user = auth.getUser();
  if (user && (user.role === 'factory' || user.role === 'admin')) {
    createListingContainer.style.display = 'block';
  }

  // Initial load
  loadListings();

  // Handle Filtering
  filterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const materialType = document.getElementById('filter-material').value;
    const minQuantity = document.getElementById('filter-quantity').value;
    loadListings(materialType, minQuantity);
  });

  resetFiltersBtn.addEventListener('click', () => {
    document.getElementById('filter-material').value = '';
    document.getElementById('filter-quantity').value = '';
    loadListings();
  });

  // Modal actions
  if (openModalBtn) {
    openModalBtn.addEventListener('click', () => {
      // Set tomorrow's date as default predicted date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 7);
      document.getElementById('predictedSurplusDate').value = tomorrow.toISOString().substring(0, 10);
      modal.classList.add('show');
    });
  }

  const hideModal = () => {
    modal.classList.remove('show');
    createForm.reset();
  };

  if (closeModalBtn) closeModalBtn.addEventListener('click', hideModal);
  if (cancelBtn) cancelBtn.addEventListener('click', hideModal);

  // Close modal when clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideModal();
    }
  });

  // Handle listing creation form submission
  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const materialType = document.getElementById('materialType').value;
      const quantityKg = Number(document.getElementById('quantityKg').value);
      const predictedSurplusDate = document.getElementById('predictedSurplusDate').value;
      const confidenceScore = Number(document.getElementById('confidenceScore').value);

      try {
        await apiFetch('/api/listings', {
          method: 'POST',
          body: JSON.stringify({
            materialType,
            quantityKg,
            predictedSurplusDate,
            confidenceScore
          })
        });

        notifications.showSuccess('Listing published successfully!');
        hideModal();
        loadListings(); // reload list
      } catch (err) {
        notifications.showError(err.message || 'Failed to publish listing.');
      }
    });
  }

  /**
   * Loads listings from the backend database.
   */
  async function loadListings(materialType = '', minQuantity = '') {
    listingsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem; color: var(--clr-text-muted);">
        <p style="font-size: 1.1rem; font-weight: 500;">Loading waste listings...</p>
      </div>
    `;

    try {
      let queryPath = '/api/listings';
      const params = new URLSearchParams();
      if (materialType) params.append('materialType', materialType);
      if (minQuantity) params.append('minQuantity', minQuantity);
      
      const queryString = params.toString();
      if (queryString) {
        queryPath += `?${queryString}`;
      }

      const res = await apiFetch(queryPath);
      renderListings(res.listings || []);
    } catch (err) {
      listingsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem; color: var(--clr-error);">
          <p style="font-size: 1.1rem; font-weight: 600;">Failed to load listings</p>
          <p style="font-size: 0.9rem; margin-top: 0.5rem;">${err.message}</p>
        </div>
      `;
    }
  }

  /**
   * Renders the listings grid UI dynamically.
   */
  function renderListings(listings) {
    if (listings.length === 0) {
      listingsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem; color: var(--clr-text-muted);">
          <svg style="width: 48px; height: 48px; margin: 0 auto 1rem auto; display: block; opacity: 0.5;" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.008 1.24l.885 1.77a2.25 2.25 0 002.007 1.24h1.98a2.25 2.25 0 002.007-1.24l.885-1.77a2.25 2.25 0 012.007-1.24h3.86m-18 0h18a2.25 2.25 0 012.25 2.25v4.5A2.25 2.25 0 0118.75 21H5.25A2.25 2.25 0 013 18.75v-4.5A2.25 2.25 0 012.25 13.5zm0-4.5h18a2.25 2.25 0 012.25 2.25v.75H3V11.25A2.25 2.25 0 015.25 9z"/>
          </svg>
          <p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem;">No surplus listings yet</p>
          <p style="font-size: 0.9rem;">Check back later or apply different filters.</p>
        </div>
      `;
      return;
    }

    listingsGrid.innerHTML = '';

    listings.forEach(listing => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.justifyContent = 'space-between';
      card.style.height = '100%';

      // Formatted date
      let dateString = 'Not specified';
      if (listing.predicted_surplus_date) {
        try {
          const d = new Date(listing.predicted_surplus_date);
          dateString = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (e) {
          dateString = listing.predicted_surplus_date;
        }
      }

      // Confidence badge class
      const confidence = listing.confidence_score ? Math.round(listing.confidence_score * 100) : 95;
      const confidenceColor = confidence >= 90 ? 'var(--clr-success)' : 'var(--clr-warning)';

      const myFactory = auth.getFactory();
      const isMyOwnListing = myFactory && listing.factory_id && String(myFactory.id) === String(listing.factory_id);

      let actionHtml = '';
      if (isMyOwnListing) {
        actionHtml = `
          <button class="btn btn-secondary" style="width: 100%; cursor: not-allowed;" disabled>
            Your Listing
          </button>
        `;
      } else {
        actionHtml = `
          <button class="btn btn-primary request-match-btn" data-id="${listing.id}" style="width: 100%;">
            Request Match
          </button>
        `;
      }

      card.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
            <span class="badge" style="background-color: var(--clr-primary-glow); color: var(--clr-primary); text-transform: capitalize;">
              ${listing.industry_type || 'General'} Industry
            </span>
            <span style="font-size: 0.85rem; font-weight: 600; color: ${confidenceColor};">
              ${confidence}% AI Match Confidence
            </span>
          </div>

          <h3 style="font-size: 1.35rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--clr-text-main);">
            ${listing.material_type}
          </h3>

          <div style="margin: 1.25rem 0; display: flex; flex-direction: column; gap: 0.6rem; font-size: 0.92rem; color: var(--clr-text-muted);">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--clr-border); padding-bottom: 0.4rem;">
              <span>Quantity:</span>
              <strong style="color: var(--clr-text-main);">${Number(listing.quantity_kg).toLocaleString()} kg</strong>
            </div>
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--clr-border); padding-bottom: 0.4rem;">
              <span>Source Factory:</span>
              <strong style="color: var(--clr-text-main);">${listing.factory_name || 'Taiwan Factory'}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Expected Date:</span>
              <strong style="color: var(--clr-text-main);">${dateString}</strong>
            </div>
          </div>
        </div>

        <div style="margin-top: 1.5rem;">
          ${actionHtml}
        </div>
      `;

      listingsGrid.appendChild(card);
    });

    // Add match request action handlers
    const matchBtns = listingsGrid.querySelectorAll('.request-match-btn');
    matchBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const listingId = Number(btn.getAttribute('data-id'));
        await handleRequestMatch(listingId, btn);
      });
    });
  }

  /**
   * Submits a match request to the backend.
   */
  async function handleRequestMatch(listingId, button) {
    if (!auth.isAuthenticated()) {
      notifications.showInfo('Authentication required. Redirecting to login...');
      setTimeout(() => {
        window.location.href = `login.html?redirect=${encodeURIComponent(window.location.href)}`;
      }, 1500);
      return;
    }

    button.disabled = true;
    button.textContent = 'Submitting Request...';

    // Simulate compatibility score based on random calculations (85-98%)
    const compatibilityScore = Number((Math.random() * (0.98 - 0.85) + 0.85).toFixed(2));

    try {
      await apiFetch('/api/matches', {
        method: 'POST',
        body: JSON.stringify({
          listingId,
          compatibilityScore
        })
      });

      notifications.showSuccess('Match request sent successfully!');
      button.textContent = 'Request Sent';
      button.className = 'btn btn-secondary';
      button.disabled = true;
    } catch (err) {
      notifications.showError(err.message || 'Failed to submit match request.');
      button.disabled = false;
      button.textContent = 'Request Match';
    }
  }
});
