/**
 * search.js
 * Handles the material search page — calls GET /api/listings/search?material=<name>
 * and renders factory cards with AI compatibility scores.
 */
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('material-search-input');
  const searchBtn   = document.getElementById('search-btn');
  const resultsGrid = document.getElementById('results-grid');
  const chips       = document.querySelectorAll('.material-chip');

  // Pre-fill from URL param (e.g. search.html?material=metal_offcut)
  const params = new URLSearchParams(window.location.search);
  const initMaterial = params.get('material') || '';
  if (initMaterial) {
    searchInput.value = initMaterial;
    doSearch(initMaterial);
  }

  searchBtn.addEventListener('click', () => {
    const val = searchInput.value.trim();
    if (val) doSearch(val);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = searchInput.value.trim();
      if (val) doSearch(val);
    }
  });

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const material = chip.getAttribute('data-material');
      searchInput.value = material;
      doSearch(material);
    });
  });

  async function doSearch(material) {
    renderLoading();
    try {
      const data = await apiFetch(`/api/listings/search?material=${encodeURIComponent(material)}`);
      renderResults(data.factories || [], material);
    } catch (err) {
      renderError(err.message);
    }
  }

  function renderLoading() {
    resultsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 0; color: var(--clr-text-muted);">
        <div class="spinner" style="width: 40px; height: 40px; border: 3px solid var(--clr-border); border-top-color: var(--clr-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem;"></div>
        <p>Searching factories…</p>
      </div>
    `;
  }

  function renderError(msg) {
    resultsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 0; color: var(--clr-error);">
        <p style="font-weight: 600; font-size: 1.1rem;">Search failed</p>
        <p style="font-size: 0.9rem; margin-top: 0.5rem;">${msg}</p>
      </div>
    `;
  }

  function renderResults(factories, material) {
    if (factories.length === 0) {
      resultsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 5rem 2rem; color: var(--clr-text-muted);">
          <p style="font-size: 1.1rem; font-weight: 600;">No factories found for <em>${material}</em>.</p>
          <p style="font-size: 0.9rem; margin-top: 0.5rem;">Try a different material or check back after sellers upload their schedules.</p>
        </div>
      `;
      return;
    }

    resultsGrid.innerHTML = '';

    factories.forEach((factory) => {
      const card = document.createElement('div');
      card.className = 'factory-search-card';

      // Compatibility score display
      const rawScore    = factory.compatibilityScore != null ? factory.compatibilityScore : null;
      const scoreVal    = rawScore != null ? Math.round(rawScore) : '—';
      const scoreClass  = rawScore == null ? 'score-mid' : rawScore >= 70 ? 'score-high' : rawScore >= 40 ? 'score-mid' : 'score-low';
      const distanceStr = factory.distanceKm != null ? `${factory.distanceKm.toFixed(1)} km away` : '';
      const trustBadge  = factory.trust_score ? `Trust: ${Math.round(factory.trust_score)} pts` : '';

      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div class="compat-score-ring ${scoreClass}">${scoreVal}</div>
          <div style="flex: 1; min-width: 0;">
            <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--clr-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${factory.name || 'Unknown Factory'}</h3>
            <span class="badge" style="background: var(--clr-primary-glow); color: var(--clr-primary-light); text-transform: capitalize; font-size: 0.75rem; margin-top: 0.2rem; display: inline-block;">${factory.industry_type || 'Industry'}</span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.88rem; color: var(--clr-text-muted);">
          ${distanceStr ? `<div style="display: flex; justify-content: space-between;"><span>Distance</span><strong style="color: var(--clr-text-main);">${distanceStr}</strong></div>` : ''}
          ${trustBadge ? `<div style="display: flex; justify-content: space-between;"><span>Trust Rating</span><strong style="color: var(--clr-primary-light);">${trustBadge}</strong></div>` : ''}
          <div style="display: flex; justify-content: space-between;"><span>Material</span><strong style="color: var(--clr-text-main); text-transform: capitalize;">${material}</strong></div>
        </div>

        <a href="factory-schedule.html?factoryId=${factory.factory_id}&material=${encodeURIComponent(material)}"
           class="btn btn-primary" style="width: 100%; text-align: center; text-decoration: none;">
          View Schedule &amp; Book Slot →
        </a>
      `;

      resultsGrid.appendChild(card);
    });
  }
});

// Spinner keyframe (injected inline so no CSS file change needed)
const styleEl = document.createElement('style');
styleEl.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(styleEl);
