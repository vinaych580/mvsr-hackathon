/* =========================================================
   AgriSim — Farm boundary drawing
   Leaflet + leaflet-draw + Turf.js
   - Draw a polygon on a satellite map
   - Auto-compute area (acres / hectares) and centroid
   - Fetch soil properties at the centroid via SoilGrids v2
   - Store result in localStorage so the dashboard can pre-fill
   ========================================================= */

(() => {
  const mapEl = document.getElementById('farmMap');
  if (!mapEl || typeof L === 'undefined') return;

  /* ---------- Map ---------- */
  const map = L.map(mapEl, { zoomControl: true }).setView([22.5, 79], 5);

  // Esri World Imagery (satellite) + OSM labels overlay
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Imagery © Esri', maxZoom: 19 }
  ).addTo(map);
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
    { attribution: '© OSM © CartoDB', maxZoom: 19, opacity: 0.85 }
  ).addTo(map);

  /* ---------- Drawing ---------- */
  const drawnItems = new L.FeatureGroup().addTo(map);
  const drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: { color: '#c88a3a', weight: 3, fillOpacity: 0.25 }
      },
      rectangle: { shapeOptions: { color: '#c88a3a', weight: 3, fillOpacity: 0.25 } },
      polyline: false, circle: false, circlemarker: false, marker: false
    },
    edit: { featureGroup: drawnItems, remove: true }
  });
  map.addControl(drawControl);

  const summaryEl = document.getElementById('farmSummary');
  const actionsEl = document.getElementById('farmActions');

  let currentLayer = null;
  let currentData = null;

  function onShapeCreated(layer) {
    if (currentLayer) drawnItems.removeLayer(currentLayer);
    currentLayer = layer;
    drawnItems.addLayer(layer);
    computeAndShow(layer);
  }

  map.on(L.Draw.Event.CREATED, (e) => onShapeCreated(e.layer));
  map.on(L.Draw.Event.EDITED, (e) => {
    e.layers.eachLayer(l => { if (l === currentLayer) computeAndShow(l); });
  });
  map.on(L.Draw.Event.DELETED, () => {
    currentLayer = null; currentData = null;
    renderEmpty();
  });

  function renderEmpty() {
    summaryEl.innerHTML = '<div class="farmmap__empty">No farm drawn yet.</div>';
    actionsEl.style.display = 'none';
  }

  function renderSummary(d, soilState) {
    const soilHtml = soilState === 'loading'
      ? '<div class="farmmap__muted">Fetching soil data…</div>'
      : soilState === 'error'
      ? '<div class="farmmap__muted">Soil lookup unavailable offline. Coordinates saved.</div>'
      : d.soil
        ? `
          <div class="farmmap__grid">
            <div><span>pH</span><b>${d.soil.phh2o != null ? d.soil.phh2o.toFixed(1) : '—'}</b></div>
            <div><span>Nitrogen</span><b>${d.soil.nitrogen != null ? d.soil.nitrogen.toFixed(0) : '—'} <small>cg/kg</small></b></div>
            <div><span>Clay</span><b>${d.soil.clay != null ? d.soil.clay.toFixed(1) : '—'} <small>%</small></b></div>
            <div><span>Sand</span><b>${d.soil.sand != null ? d.soil.sand.toFixed(1) : '—'} <small>%</small></b></div>
            <div><span>Organic C</span><b>${d.soil.soc != null ? d.soil.soc.toFixed(0) : '—'} <small>g/kg</small></b></div>
            <div><span>CEC</span><b>${d.soil.cec != null ? d.soil.cec.toFixed(0) : '—'}</b></div>
          </div>`
        : '';

    summaryEl.innerHTML = `
      <div class="farmmap__stat">
        <span>Area</span>
        <b>${d.acres.toFixed(2)} <small>acres</small></b>
        <em>${d.hectares.toFixed(2)} ha · ${(d.sqm).toLocaleString()} m²</em>
      </div>
      <div class="farmmap__stat">
        <span>Perimeter</span>
        <b>${(d.perimeterM).toFixed(0)} <small>m</small></b>
      </div>
      <div class="farmmap__stat">
        <span>Centroid</span>
        <b>${d.centroid[1].toFixed(4)}°, ${d.centroid[0].toFixed(4)}°</b>
        <em>${d.nearestState || 'India'}</em>
      </div>
      <h4 class="farmmap__h">Soil at centroid <small>(SoilGrids v2, 0–5 cm)</small></h4>
      ${soilHtml}
    `;
    actionsEl.style.display = '';
  }

  async function computeAndShow(layer) {
    const gj = layer.toGeoJSON();
    const sqm = turf.area(gj); // m²
    const hectares = sqm / 10000;
    const acres = sqm / 4046.8564224;
    const centroid = turf.centroid(gj).geometry.coordinates; // [lon, lat]
    let perimeterM = 0;
    try {
      const line = turf.polygonToLine(gj);
      perimeterM = turf.length(line, { units: 'meters' });
    } catch (_) {}

    // Rough state guess via AgriSimStateData centroid table is not available
    // on this page — skip; user can still save.
    currentData = {
      geojson: gj, sqm, hectares, acres, centroid, perimeterM,
      nearestState: null, soil: null,
      savedAt: new Date().toISOString()
    };
    renderSummary(currentData, 'loading');

    // Fetch soil
    try {
      const soil = await fetchSoil(centroid[1], centroid[0]);
      currentData.soil = soil;
      renderSummary(currentData, 'done');
    } catch (e) {
      console.warn('[farm-map] soil fetch failed:', e);
      renderSummary(currentData, 'error');
    }
  }

  async function fetchSoil(lat, lon) {
    // SoilGrids v2.0 REST — public, CORS enabled.
    const props = ['phh2o', 'nitrogen', 'clay', 'sand', 'soc', 'cec'];
    const qs = props.map(p => `property=${p}`).join('&');
    const url = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}&${qs}&depth=0-5cm&value=mean`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    const out = {};
    const layers = (data && data.properties && data.properties.layers) || [];
    layers.forEach(layer => {
      const name = layer.name;
      const dfactor = (layer.unit_measure && layer.unit_measure.d_factor) || 1;
      const depths = layer.depths || [];
      const d = depths[0];
      const mean = d && d.values && d.values.mean;
      if (mean != null) out[name] = mean / dfactor;
    });
    return out;
  }

  /* ---------- Search (Nominatim) ---------- */
  const searchInput = document.getElementById('farmSearch');
  const searchBtn = document.getElementById('farmSearchBtn');
  async function doSearch() {
    const q = (searchInput.value || '').trim();
    if (!q) return;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      if (data && data[0]) {
        const { lat, lon } = data[0];
        map.setView([+lat, +lon], 15);
      } else {
        alert('Place not found.');
      }
    } catch (e) {
      alert('Search failed: ' + e.message);
    }
  }
  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  /* ---------- Clear + Use ---------- */
  document.getElementById('farmClear').addEventListener('click', () => {
    drawnItems.clearLayers();
    currentLayer = null; currentData = null;
    renderEmpty();
  });
  document.getElementById('farmUse').addEventListener('click', () => {
    if (!currentData) return;
    try {
      localStorage.setItem('agrisim_farm', JSON.stringify(currentData));
      window.location.href = 'dashboard.html?fromMap=1';
    } catch (e) {
      alert('Could not save farm locally: ' + e.message);
    }
  });

  renderEmpty();
})();
