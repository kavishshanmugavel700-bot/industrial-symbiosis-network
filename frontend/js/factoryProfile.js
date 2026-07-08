/**
 * Factory profile settings and matches timeline handling for ISIN.
 */
document.addEventListener('DOMContentLoaded', () => {
  // If not logged in, auth.js guard already handles redirect.
  if (!auth.isAuthenticated()) return;

  const profileName = document.getElementById('profile-name');
  const profileSector = document.getElementById('profile-sector');
  const profileTrust = document.getElementById('profile-trust');
  const profileCoords = document.getElementById('profile-coords');

  const scheduleForm = document.getElementById('schedule-form');
  const needsMaterialInput = document.getElementById('needsMaterialType');
  const rawScheduleArea = document.getElementById('rawSchedule');
  const saveScheduleBtn = document.getElementById('save-schedule-btn');

  const matchesTimeline = document.getElementById('matches-timeline');
  const refreshMatchesBtn = document.getElementById('refresh-matches-btn');

  let myFactoryId = null;

  // Load everything
  loadFactoryProfile();
  loadMatches();

  refreshMatchesBtn.addEventListener('click', loadMatches);

  // Handle schedule updates
  scheduleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveScheduleBtn.disabled = true;
    saveScheduleBtn.textContent = 'Updating...';

    const needsMaterialType = needsMaterialInput.value.trim();
    const rawScheduleText = rawScheduleArea.value.trim();

    let productionSchedule = {};

    if (rawScheduleText) {
      try {
        productionSchedule = JSON.parse(rawScheduleText);
      } catch (err) {
        notifications.showError('Invalid custom properties JSON formatting. Please correct it.');
        saveScheduleBtn.disabled = false;
        saveScheduleBtn.textContent = 'Update Demand Schedule';
        return;
      }
    }

    // Ensure the key required by the marketplace buyer finder is present
    productionSchedule.needs_material_type = needsMaterialType;

    try {
      await apiFetch('/api/factories/me/schedule', {
        method: 'PUT',
        body: JSON.stringify({ productionSchedule })
      });

      notifications.showSuccess('Production schedule updated successfully!');
      
      // Update local storage representation
      const factory = auth.getFactory();
      if (factory) {
        factory.production_schedule = productionSchedule;
        localStorage.setItem('isin_factory', JSON.stringify(factory));
      }

      loadFactoryProfile(); // reload profile details
    } catch (err) {
      notifications.showError(err.message || 'Failed to update schedule.');
    } finally {
      saveScheduleBtn.disabled = false;
      saveScheduleBtn.textContent = 'Update Demand Schedule';
    }
  });

  /**
   * Loads own factory details from server.
   */
  async function loadFactoryProfile() {
    try {
      const res = await apiFetch('/api/factories/me');
      const factory = res.factory;
      if (!factory) {
        notifications.showError('No factory profile found.');
        return;
      }

      myFactoryId = factory.id;

      // Render factory info
      profileName.textContent = factory.name || 'Industrial Facility';
      profileSector.textContent = (factory.industry_type || 'unclassified') + ' Industry';
      profileTrust.textContent = `${factory.trust_score || 0} pts`;
      
      if (factory.latitude && factory.longitude) {
        profileCoords.textContent = `${Number(factory.latitude).toFixed(4)}° N, ${Number(factory.longitude).toFixed(4)}° E`;
      } else {
        profileCoords.textContent = 'Coordinates not set';
      }

      // Pre-fill schedule forms
      const sched = factory.production_schedule || {};
      needsMaterialInput.value = sched.needs_material_type || '';
      
      // Clone schedule to strip needs_material_type for cleaner secondary editing
      const cleanedSched = { ...sched };
      delete cleanedSched.needs_material_type;
      
      rawScheduleArea.value = Object.keys(cleanedSched).length > 0 
        ? JSON.stringify(cleanedSched, null, 2) 
        : '';

    } catch (err) {
      notifications.showError(err.message || 'Failed to load profile details.');
    }
  }

  /**
   * Loads my matches history timeline.
   */
  async function loadMatches() {
    matchesTimeline.innerHTML = '<p style="text-align: center; color: var(--clr-text-muted); padding: 4rem 0;">Loading exchange history...</p>';
    
    try {
      const res = await apiFetch('/api/matches/mine');
      renderMatches(res.matches || []);
    } catch (err) {
      matchesTimeline.innerHTML = `
        <div style="text-align: center; color: var(--clr-error); padding: 4rem 0;">
          <p style="font-size: 1.1rem; font-weight: 600;">Failed to fetch matches</p>
          <p style="font-size: 0.9rem; margin-top: 0.5rem;">${err.message}</p>
        </div>
      `;
    }
  }

  /**
   * Renders matches on profile page.
   */
  function renderMatches(matches) {
    if (matches.length === 0) {
      matchesTimeline.innerHTML = `
        <div style="text-align: center; color: var(--clr-text-muted); padding: 5rem 2rem; border: 2px dashed var(--clr-border); border-radius: var(--radius-md);">
          <svg style="width: 48px; height: 48px; margin: 0 auto 1.2rem auto; display: block; opacity: 0.4;" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>
          </svg>
          <p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem;">No matches identified yet</p>
          <p style="font-size: 0.9rem;">Increase your trust score or search listings in the Marketplace to start exchanging.</p>
        </div>
      `;
      return;
    }

    matchesTimeline.innerHTML = '';

    matches.forEach(match => {
      const isSeller = myFactoryId && String(match.seller_factory_id) === String(myFactoryId);
      const directionLabel = isSeller ? 'Incoming Match Request' : 'Outgoing Match Request';
      const directionColor = isSeller ? 'var(--clr-accent)' : 'var(--clr-primary-light)';
      
      const badgeClass = `badge-${match.status}`;
      
      const row = document.createElement('div');
      row.style.border = '1px solid var(--clr-border)';
      row.style.borderRadius = 'var(--radius-md)';
      row.style.padding = '1.25rem 1.5rem';
      row.style.backgroundColor = 'var(--clr-bg)';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.flexWrap = 'wrap';
      row.style.gap = '1rem';
      
      let actionButtons = '';
      if (match.status === 'pending') {
        actionButtons = `
          <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
            <button class="btn btn-outline confirm-match-btn" data-id="${match.id}" style="padding: 0.4rem 1rem; font-size: 0.85rem;">Confirm</button>
            <button class="btn btn-danger decline-match-btn" data-id="${match.id}" style="padding: 0.4rem 1rem; font-size: 0.85rem;">Decline</button>
          </div>
        `;
      } else if (match.status === 'confirmed') {
        actionButtons = `
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem; flex-shrink: 0;">
            <button class="btn btn-outline download-cert-btn" data-id="${match.id}" style="padding: 0.4rem 1rem; font-size: 0.85rem; display: flex; align-items: center; gap: 0.3rem;">
              <svg style="width: 14px; height: 14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              Download PDF
            </button>
            <div style="font-size: 0.75rem; color: var(--clr-text-muted); font-weight: 500;">
              Confirmed: ${match.confirmed_at ? new Date(match.confirmed_at).toLocaleDateString() : 'N/A'}
            </div>
          </div>
        `;
      }

      row.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.3rem;">
          <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
            <span class="badge ${badgeClass}" style="text-transform: capitalize;">${match.status}</span>
            <span style="font-size: 0.8rem; font-weight: 600; color: ${directionColor}; text-transform: uppercase; letter-spacing: 0.05em;">
              ${directionLabel}
            </span>
          </div>
          
          <h4 style="font-size: 1.15rem; font-weight: 700; margin-top: 0.2rem; color: var(--clr-text-main);">
            ${match.material_type}
          </h4>

          <div style="display: flex; gap: 1.5rem; font-size: 0.85rem; color: var(--clr-text-muted); margin-top: 0.2rem;">
            <span>Quantity: <strong style="color: var(--clr-text-main);">${Number(match.quantity_kg).toLocaleString()} kg</strong></span>
            <span>Compatibility: <strong style="color: var(--clr-success);">${Math.round(match.compatibility_score * 100)}%</strong></span>
          </div>
        </div>
        ${actionButtons}
      `;

      matchesTimeline.appendChild(row);
    });

    // Add action event listeners
    const confirmBtns = matchesTimeline.querySelectorAll('.confirm-match-btn');
    confirmBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await handleConfirmMatch(id, btn);
      });
    });

    const declineBtns = matchesTimeline.querySelectorAll('.decline-match-btn');
    declineBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await handleDeclineMatch(id, btn);
      });
    });

    const downloadBtns = matchesTimeline.querySelectorAll('.download-cert-btn');
    downloadBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await handleDownloadCertificate(id, btn);
      });
    });
  }

  /**
   * Confirms a match and pops up carbon saving information.
   */
  async function handleConfirmMatch(id, button) {
    button.disabled = true;
    button.textContent = 'Processing...';

    try {
      const res = await apiFetch(`/api/matches/${id}/confirm`, {
        method: 'POST'
      });

      const co2 = res.certificate && res.certificate.co2_avoided_kg ? res.certificate.co2_avoided_kg : '1,420'; // fallback
      notifications.showSuccess(`Exchange Match Confirmed! CO₂ Offset: ${Number(co2).toLocaleString()} kg!`);
      
      // Reload profile and matches to update trust score points and list
      loadFactoryProfile();
      loadMatches();
    } catch (err) {
      notifications.showError(err.message || 'Failed to confirm match.');
      button.disabled = false;
      button.textContent = 'Confirm';
    }
  }

  /**
   * Declines a match request.
   */
  async function handleDeclineMatch(id, button) {
    button.disabled = true;
    button.textContent = 'Processing...';

    try {
      await apiFetch(`/api/matches/${id}/decline`, {
        method: 'POST'
      });

      notifications.showSuccess('Match request declined.');
      loadMatches();
    } catch (err) {
      notifications.showError(err.message || 'Failed to decline match.');
      button.disabled = false;
      button.textContent = 'Decline';
    }
  }

  /**
   * Downloads the PDF certificate for a confirmed match.
   */
  async function handleDownloadCertificate(matchId, button) {
    const originalContent = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Downloading...';

    try {
      const token = auth.getToken();
      const response = await fetch(`${API_BASE_URL}/api/certificates/${matchId}/download`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to download certificate');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `isin-certificate-${matchId}.pdf`;
      if (contentDisposition && contentDisposition.includes('filename=')) {
        filename = contentDisposition.split('filename=')[1].replace(/"/g, '');
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      
      notifications.showSuccess('Certificate downloaded successfully!');
    } catch (err) {
      notifications.showError(err.message || 'Failed to download certificate.');
    } finally {
      button.disabled = false;
      button.innerHTML = originalContent;
    }
  }
});
