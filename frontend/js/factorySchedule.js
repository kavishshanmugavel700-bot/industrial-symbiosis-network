/**
 * factorySchedule.js
 * Handles the factory production schedule detail page.
 * Reads ?factoryId=<id>&material=<name> from the URL, fetches slots, and renders them.
 */
document.addEventListener('DOMContentLoaded', () => {
  const urlParams  = new URLSearchParams(window.location.search);
  const factoryId  = urlParams.get('factoryId');
  const material   = urlParams.get('material') || '';

  const slotsList     = document.getElementById('slots-list');
  const factoryNameEl = document.getElementById('factory-name');
  const factorySector = document.getElementById('factory-sector');
  const factoryTrust  = document.getElementById('factory-trust');
  const materialLabel = document.getElementById('material-label');
  const backBtn       = document.getElementById('back-btn');
  const modal         = document.getElementById('purchase-modal');
  const modalDetails  = document.getElementById('modal-details');
  const modalCancelBtn  = document.getElementById('modal-cancel-btn');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');

  // Update back button to include material param
  if (material) {
    backBtn.href = `search.html?material=${encodeURIComponent(material)}`;
  }

  if (!factoryId) {
    slotsList.innerHTML = '<p style="color: var(--clr-error); text-align: center; padding: 3rem 0;">No factory specified. Go back and select a factory.</p>';
    return;
  }

  if (material) {
    materialLabel.textContent = `Showing slots for: ${material.replace(/_/g, ' ')}`;
  }

  // Load schedule
  loadSchedule();

  async function loadSchedule() {
    try {
      let url = `/api/factories/${factoryId}/schedule`;
      if (material) url += `?material=${encodeURIComponent(material)}`;
      const data = await apiFetch(url);

      const { factory, slots } = data;

      // Render factory header
      factoryNameEl.textContent = factory.name || 'Factory';
      factorySector.textContent = (factory.industryType || 'Industry') + ' Sector';
      if (factory.trustScore != null) {
        factoryTrust.textContent = `Trust Score: ${Math.round(factory.trustScore)} pts`;
      }

      renderSlots(slots || []);
    } catch (err) {
      slotsList.innerHTML = `
        <div style="text-align: center; padding: 3rem 0; color: var(--clr-error);">
          <p style="font-weight: 600;">Failed to load schedule</p>
          <p style="font-size: 0.9rem; margin-top: 0.5rem;">${err.message}</p>
        </div>`;
    }
  }

  function renderSlots(slots) {
    if (slots.length === 0) {
      slotsList.innerHTML = `
        <div style="text-align: center; padding: 4rem 2rem; border: 2px dashed var(--clr-border); border-radius: var(--radius-md); color: var(--clr-text-muted);">
          <p style="font-size: 1.05rem; font-weight: 600;">No production slots available for this material.</p>
          <p style="font-size: 0.9rem; margin-top: 0.4rem;">The seller may not have uploaded a schedule yet.</p>
        </div>`;
      return;
    }

    slotsList.innerHTML = '';

    slots.forEach((slot) => {
      const isPdf       = slot.source === 'pdf';
      const isPurchased = slot.status === 'purchased';

      // Date formatting
      let dateStr = '—';
      try {
        const d = new Date(slot.productionDate);
        dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      } catch (_) {}

      const badgeHtml = isPurchased
        ? `<span class="badge badge-purchased">Reserved</span>`
        : isPdf
          ? `<span class="badge badge-confirmed">✅ Confirmed</span>`
          : `<span class="badge badge-forecast">🤖 AI Forecast</span>`;

      const actionHtml = isPurchased
        ? `<button class="btn btn-secondary" disabled style="padding: 0.5rem 1.2rem; font-size: 0.85rem;">Reserved</button>`
        : `<button class="btn btn-primary reserve-btn" data-id="${slot.id}"
             data-material="${slot.materialType}" data-qty="${slot.quantityKg}"
             data-date="${dateStr}" data-source="${slot.source}"
             style="padding: 0.5rem 1.2rem; font-size: 0.85rem; white-space: nowrap;">
             Reserve this slot
           </button>`;

      const card = document.createElement('div');
      card.className = `slot-card source-${slot.source}${isPurchased ? ' purchased' : ''}`;
      card.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.4rem; flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
            ${badgeHtml}
            <span style="font-size: 0.78rem; color: var(--clr-text-muted); text-transform: capitalize;">${(slot.materialType || '').replace(/_/g, ' ')}</span>
          </div>
          <p style="font-size: 1.05rem; font-weight: 700; color: var(--clr-text-main);">${dateStr}</p>
          <p style="font-size: 0.88rem; color: var(--clr-text-muted);">
            Quantity: <strong style="color: var(--clr-text-main);">${Number(slot.quantityKg).toLocaleString()} kg</strong>
          </p>
        </div>
        <div style="flex-shrink: 0;">
          ${actionHtml}
        </div>
      `;

      slotsList.appendChild(card);
    });

    // Wire up Reserve buttons
    document.querySelectorAll('.reserve-btn').forEach((btn) => {
      btn.addEventListener('click', () => openPurchaseModal(btn));
    });
  }

  // ---- Purchase modal ----
  let pendingEntryId = null;

  function openPurchaseModal(btn) {
    if (!auth.isAuthenticated()) {
      notifications.showInfo('Please log in to reserve a slot.');
      setTimeout(() => { window.location.href = `login.html?redirect=${encodeURIComponent(window.location.href)}`; }, 1500);
      return;
    }

    pendingEntryId = btn.getAttribute('data-id');
    const material = (btn.getAttribute('data-material') || '').replace(/_/g, ' ');
    const qty      = btn.getAttribute('data-qty');
    const date     = btn.getAttribute('data-date');
    const source   = btn.getAttribute('data-source');

    modalDetails.innerHTML = `
      <div style="background: var(--clr-bg); border-radius: var(--radius-md); padding: 1rem; line-height: 2;">
        <div><strong>Material:</strong> ${material}</div>
        <div><strong>Quantity:</strong> ${Number(qty).toLocaleString()} kg</div>
        <div><strong>Date:</strong> ${date}</div>
        <div><strong>Slot Type:</strong> ${source === 'pdf' ? '✅ Confirmed' : '🤖 AI Forecast'}</div>
      </div>
      <p style="margin-top: 1rem; font-size: 0.85rem; color: var(--clr-text-muted);">
        Clicking <strong>Reserve</strong> will mark this slot as purchased and download a PDF confirmation receipt.
      </p>
    `;
    modal.classList.add('open');
  }

  modalCancelBtn.addEventListener('click', () => {
    modal.classList.remove('open');
    pendingEntryId = null;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('open');
      pendingEntryId = null;
    }
  });

  modalConfirmBtn.addEventListener('click', async () => {
    if (!pendingEntryId) return;

    modalConfirmBtn.disabled  = true;
    modalConfirmBtn.textContent = 'Processing…';

    try {
      const token    = localStorage.getItem('isin_token');
      const response = await fetch(`${API_BASE_URL}/api/listings/purchase`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ entryId: pendingEntryId }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Purchase failed');
      }

      // Trigger PDF download
      const blob    = await response.blob();
      const url     = window.URL.createObjectURL(blob);
      const a       = document.createElement('a');
      const cd      = response.headers.get('Content-Disposition') || '';
      const fnMatch = cd.match(/filename="([^"]+)"/);
      a.href        = url;
      a.download    = fnMatch ? fnMatch[1] : `slot-confirmation-${pendingEntryId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      notifications.showSuccess('Slot reserved! Confirmation PDF downloaded.');
      modal.classList.remove('open');
      pendingEntryId = null;

      // Reload to show updated status
      await loadSchedule();
    } catch (err) {
      notifications.showError(err.message || 'Failed to reserve slot.');
    } finally {
      modalConfirmBtn.disabled  = false;
      modalConfirmBtn.textContent = 'Reserve & Download Receipt';
    }
  });
});
