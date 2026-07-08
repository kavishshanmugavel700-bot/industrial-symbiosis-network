/**
 * Leaflet Geo-mapping initialization and factory markers rendering for ISIN.
 */
document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('map');
  if (!mapElement) return; // Only execute on pages containing the map

  // Default coordinate center on Taiwan (Hsinchu / Taichung midpoint)
  const map = L.map('map').setView([23.8, 121.0], 7.5);

  // Add highly readable OpenStreetMap map layer tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // Fetch and plot all registered factories
  loadFactoryMarkers(map);
});

/**
 * Queries all registered factories from database and markers map.
 * @param {L.Map} map - Leaflet map reference object
 */
async function loadFactoryMarkers(map) {
  try {
    const res = await apiFetch('/api/factories');
    const factories = res.factories || [];
    
    // Update participating factories count in the widget (if exists)
    const widgetFactories = document.getElementById('stat-factories');
    if (widgetFactories) {
      widgetFactories.textContent = factories.length.toString();
    }

    let validMarkersCount = 0;

    factories.forEach(factory => {
      // Check for valid lat/lon, otherwise skip from rendering on geographical map
      if (factory.latitude && factory.longitude) {
        const lat = Number(factory.latitude);
        const lon = Number(factory.longitude);

        if (!isNaN(lat) && !isNaN(lon)) {
          // Choose indicator color depending on sector
          const sector = factory.industry_type || 'General';
          const name = factory.name || 'Industrial Facility';
          const trust = factory.trust_score || 0;

          const marker = L.marker([lat, lon]).addTo(map);
          
          marker.bindPopup(`
            <div style="font-family: 'Outfit', sans-serif; font-size: 0.9rem; min-width: 180px;">
              <h4 style="font-weight: 700; color: var(--clr-text-main); margin-bottom: 0.2rem;">${name}</h4>
              <span class="badge" style="background-color: var(--clr-primary-glow); color: var(--clr-primary); font-size: 0.75rem; padding: 0.2rem 0.5rem; text-transform: capitalize; margin-bottom: 0.5rem; display: inline-block;">
                ${sector}
              </span>
              <div style="display: flex; justify-content: space-between; font-size: 0.8rem; border-top: 1px solid var(--clr-border); padding-top: 0.4rem; margin-top: 0.2rem;">
                <span style="color: var(--clr-text-muted);">Trust Rating:</span>
                <strong style="color: var(--clr-primary-light);">${trust} pts</strong>
              </div>
            </div>
          `);
          
          validMarkersCount++;
        }
      }
    });

    console.log(`Successfully mapped ${validMarkersCount} factories across Taiwan.`);

  } catch (err) {
    console.error('Failed to load factory markers onto map:', err);
    if (window.notifications) {
      window.notifications.showError('Could not load factory locations.');
    }
  }
}
