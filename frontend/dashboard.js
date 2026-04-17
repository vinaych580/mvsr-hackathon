/* =========================================================
   AgriSim Dashboard — 14 interactive tools, Chart.js visualisations
   Renderers match live API response shapes (verified 2026-04-17).
   ========================================================= */

(() => {
  'use strict';

  /* ---------- Helpers ---------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const INR = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const FIX = (n, d = 1) => (Number(n) || 0).toFixed(d);
  const PCT = n => FIX(n, 1) + '%';
  const MONTH_NAMES = ['—','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const CROP_LABELS = {
    rice: 'Rice · Dhaan', wheat: 'Wheat · Gehun', maize: 'Maize · Makka',
    sugarcane: 'Sugarcane · Ganna', cotton: 'Cotton · Kapas', pulses: 'Pulses · Dal',
    groundnut: 'Groundnut · Mungfali', soybean: 'Soybean',
    mustard: 'Mustard · Sarson', bajra: 'Bajra · Pearl Millet', jowar: 'Jowar · Sorghum',
    potato: 'Potato · Aloo', onion: 'Onion · Pyaz'
  };
  const CROP_EMOJI = {
    rice:'🌾', wheat:'🌾', maize:'🌽', sugarcane:'🎋', cotton:'🌿', pulses:'🫘',
    groundnut:'🥜', soybean:'🌱', mustard:'🌻', bajra:'🌾', jowar:'🌾',
    potato:'🥔', onion:'🧅'
  };
  const cropLabel = id => (CROP_EMOJI[id] || '🌱') + ' ' + (CROP_LABELS[id] || id);

  // Shared chart theming
  const BRAND = '#2f6b3a', BRAND_D = '#1f4d28', ACCENT = '#c88a3a', CLAY = '#a5562a', SKY = '#6ea7c7', INK = '#4a4339';
  const CHART_DEFAULTS = () => {
    if (!window.Chart) return;
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = INK;
    Chart.defaults.borderColor = 'rgba(29,26,21,.08)';
    Chart.defaults.animation.duration = 700;
    Chart.defaults.animation.easing = 'easeOutCubic';
  };
  CHART_DEFAULTS();

  // Destroy a Chart.js instance stored on an element before creating a new one
  const CHART_REGISTRY = new Map();
  function makeChart(canvasEl, config) {
    if (!canvasEl) return null;
    const prev = CHART_REGISTRY.get(canvasEl);
    if (prev) prev.destroy();
    const chart = new Chart(canvasEl.getContext('2d'), config);
    CHART_REGISTRY.set(canvasEl, chart);
    return chart;
  }

  /* ---------- Sensitivity heatmap (CSS grid, no lib) ---------- */
  function renderSensitivityHeatmap(cells, baseProfit) {
    // Cells are 25 items with yield_change_pct and price_change_pct both in {-20,-10,0,10,20}
    const ys = [...new Set(cells.map(c => c.yield_change_pct))].sort((a, b) => b - a); // top = +20 yield
    const ps = [...new Set(cells.map(c => c.price_change_pct))].sort((a, b) => a - b); // left = -20 price
    const lookup = {};
    cells.forEach(c => { lookup[`${c.yield_change_pct}_${c.price_change_pct}`] = c; });

    const profits = cells.map(c => c.projected_profit);
    const min = Math.min(...profits), max = Math.max(...profits);
    const colorFor = p => {
      const t = (p - min) / (max - min || 1); // 0..1
      // interpolate: red (low) -> cream -> green (high)
      if (t < 0.5) {
        const k = t * 2;
        return `rgb(${Math.round(225 - k * 30)}, ${Math.round(180 + k * 50)}, ${Math.round(170 + k * 50)})`;
      }
      const k = (t - 0.5) * 2;
      return `rgb(${Math.round(200 - k * 130)}, ${Math.round(230 - k * 30)}, ${Math.round(210 - k * 90)})`;
    };

    return `
      <div style="overflow-x:auto;">
        <table style="border-collapse:separate;border-spacing:4px;margin:0 auto;font-size:.82rem;">
          <thead>
            <tr>
              <th></th>
              <th colspan="${ps.length}" style="text-align:center;font-weight:600;color:var(--ink-faint);padding-bottom:6px;font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;">Price change →</th>
            </tr>
            <tr>
              <th style="font-weight:600;color:var(--ink-faint);font-size:.74rem;padding:6px;">Yield ↓</th>
              ${ps.map(p => `<th style="font-weight:600;color:var(--ink-soft);padding:6px 10px;">${p > 0 ? '+' : ''}${p}%</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${ys.map(y => `
              <tr>
                <td style="font-weight:600;color:var(--ink-soft);padding:6px 10px;text-align:right;">${y > 0 ? '+' : ''}${y}%</td>
                ${ps.map(p => {
                  const c = lookup[`${y}_${p}`];
                  if (!c) return '<td></td>';
                  const isBase = y === 0 && p === 0;
                  return `<td style="background:${colorFor(c.projected_profit)};padding:10px 12px;border-radius:6px;min-width:72px;text-align:center;font-weight:${isBase ? 700 : 500};color:var(--ink);${isBase ? 'outline:2px solid var(--brand-deep);outline-offset:-2px;' : ''}">
                    ${INR(c.projected_profit)}
                    <div style="font-size:.68rem;color:var(--ink-faint);margin-top:2px;">${FIX(c.projected_roi_pct, 0)}% ROI</div>
                  </td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
        <div style="text-align:center;margin-top:10px;font-size:.78rem;color:var(--ink-faint);">Base profit (0%, 0%) highlighted · green = higher profit</div>
      </div>`;
  }

  async function api(url, opts = {}) {
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
      if (!res.ok) {
        let msg;
        try { msg = (await res.json()).detail || res.statusText; } catch { msg = res.statusText; }
        throw new Error(`${res.status} · ${msg}`);
      }
      return res.json();
    } catch (err) {
      // Network-level failure: try the offline fallback for key routes.
      const offline = window.AgriSimOffline;
      const body = opts.body ? tryParseJSON(opts.body) : null;
      if (offline) {
        if (url.includes('/api/simulate') && body)  { flashOfflineBanner(); return offline.simulate(body); }
        if (url.includes('/api/recommend') && body) { flashOfflineBanner(); return offline.recommend(body); }
      }
      throw err;
    }
  }
  function tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
  let offlineBannerShown = false;
  function flashOfflineBanner() {
    if (offlineBannerShown) return;
    offlineBannerShown = true;
    const el = document.createElement('div');
    el.className = 'offline-banner';
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
      <span><strong>Running in offline mode.</strong> Backend unreachable — using on-device simulator.</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('offline-banner--hide'), 8000);
    setTimeout(() => el.remove(), 8600);
  }
  function showLoading(el, text = 'Working…') {
    el.innerHTML = `<div class="loading"><div class="spinner"></div><span>${text}</span></div>`;
  }
  function showError(el, err) {
    el.innerHTML = `<div class="alert alert--red"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <div class="alert__body"><strong>Request failed</strong><p>${err.message}</p></div></div>`;
  }
  function formToObj(form) {
    const obj = {};
    new FormData(form).forEach((v, k) => { obj[k] = v; });
    return obj;
  }

  /* ---------- Sidebar tool switcher ---------- */
  const btns = $$('.sidebar__btn');
  const tools = $$('.tool');
  btns.forEach(b => b.addEventListener('click', () => {
    const target = b.dataset.tool;
    btns.forEach(x => x.classList.toggle('active', x === b));
    tools.forEach(t => t.classList.toggle('active', t.dataset.tool === target));
    if (window.innerWidth < 860) tools.find(t => t.dataset.tool === target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  /* ---------- Populate region & crop selects ---------- */
  Promise.all([
    api('/api/regions').catch(() => [
      { id: 'mp_sehore', name: 'MP · Sehore' },
      { id: 'up_lucknow', name: 'UP · Lucknow' },
      { id: 'mh_pune', name: 'MH · Pune' }
    ]),
    api('/api/crops').catch(() => Object.keys(CROP_LABELS).map(c => ({ crop_id: c, crop_name: CROP_LABELS[c] })))
  ]).then(([regions, crops]) => {
    $$('select[data-regions]').forEach(sel => {
      sel.innerHTML = regions.map(r => {
        const id = r.id || r.region_id;
        const name = r.name || r.region_name || id;
        return `<option value="${id}">${name}</option>`;
      }).join('');
    });
    $$('select[data-crops]').forEach(sel => {
      const hasAny = sel.querySelector('option[value=""]');
      const isMulti = sel.multiple;
      const preselect = new Set(['rice', 'soybean', 'cotton']); // sensible defaults for compare
      const opts = crops.map(c => {
        const id = c.crop_id || c;
        const sel_attr = isMulti && preselect.has(id) ? ' selected' : '';
        return `<option value="${id}"${sel_attr}>${cropLabel(id)}</option>`;
      }).join('');
      sel.innerHTML = (hasAny ? hasAny.outerHTML : '') + opts;
    });
  });

  /* ==========================================================
     TOOL 1: Smart recommend — returns LIST directly
     ========================================================== */
  $('[data-form="recommend"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="recommend"]');
    showLoading(out, 'Running 3 ML models…');
    try {
      const f = formToObj(e.target);
      const body = {
        region_id: f.region_id, season: f.season,
        area_acres: parseFloat(f.area_acres),
        budget_per_acre: parseFloat(f.budget_per_acre)
      };
      const recs = await api('/api/recommend', { method: 'POST', body: JSON.stringify(body) });
      if (!Array.isArray(recs) || !recs.length) { out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No recommendations returned.</strong></div></div>'; return; }
      const top = recs[0];
      const area = body.area_acres;

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Top pick</div>
            <div class="kpi__val" style="font-size:1.3rem;">${cropLabel(top.crop_id)}</div>
            <div class="kpi__sub">Smart score ${FIX(top.smart_score, 1)} / 100</div></div>
          <div class="kpi"><div class="kpi__lbl">Predicted yield</div>
            <div class="kpi__val">${Math.round(top.predicted_yield_kg_per_acre)} <span style="font-size:.5em;color:var(--ink-faint)">kg/ac</span></div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Profit (${area} ac)</div>
            <div class="kpi__val">${INR(top.expected_profit)}</div>
            <div class="kpi__sub">ROI ${PCT(top.roi_percent)}</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">ML confidence</div>
            <div class="kpi__val">${PCT((top.ml_confidence || 0) * 100)}</div>
            <div class="kpi__sub">${top.prediction_source || 'ml_model'}</div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Smart score comparison</div>
            <canvas data-chart="rec-bar"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Top 3 crops · multi-factor radar</div>
            <canvas data-chart="rec-radar"></canvas>
          </div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Ranked alternatives</h4>
        ${recs.slice(0, 5).map((r, i) => `
          <div class="list-row">
            <div class="list-row__bullet">${i+1}</div>
            <div class="list-row__name">${cropLabel(r.crop_id)}
              <small>Yield ${Math.round(r.predicted_yield_kg_per_acre)} kg/ac · Risk ${Math.round(r.risk_score)}/100 · Score ${FIX(r.smart_score, 1)}</small></div>
            <div class="list-row__val">${INR(r.expected_profit)}<small>ROI ${PCT(r.roi_percent)}</small></div>
          </div>`).join('')}`;

      // Bar chart — smart score
      const top5 = recs.slice(0, 5);
      makeChart($('[data-chart="rec-bar"]'), {
        type: 'bar',
        data: {
          labels: top5.map(r => CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id),
          datasets: [{
            label: 'Smart score',
            data: top5.map(r => r.smart_score),
            backgroundColor: top5.map((_, i) => i === 0 ? BRAND : i === 1 ? ACCENT : i === 2 ? SKY : '#b4a78f'),
            borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 100, grid: { color: 'rgba(29,26,21,.06)' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });

      // Radar — top 3 across 5 axes (normalised 0–100)
      const top3 = recs.slice(0, 3);
      const maxProfit = Math.max(...top3.map(r => r.expected_profit)) || 1;
      const maxYield  = Math.max(...top3.map(r => r.predicted_yield_kg_per_acre)) || 1;
      const maxROI    = Math.max(...top3.map(r => r.roi_percent)) || 1;
      const colors = [BRAND, ACCENT, SKY];
      makeChart($('[data-chart="rec-radar"]'), {
        type: 'radar',
        data: {
          labels: ['Smart score', 'ROI %', 'Yield', 'Low risk', 'ML conf'],
          datasets: top3.map((r, i) => ({
            label: CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id,
            data: [
              r.smart_score,
              (r.roi_percent / maxROI) * 100,
              (r.predicted_yield_kg_per_acre / maxYield) * 100,
              100 - r.risk_score,
              (r.ml_confidence || 0) * 100
            ],
            backgroundColor: colors[i] + '30',
            borderColor: colors[i],
            pointBackgroundColor: colors[i],
            borderWidth: 2
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { r: { min: 0, max: 100, ticks: { display: false }, grid: { color: 'rgba(29,26,21,.08)' }, pointLabels: { font: { size: 11 } } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 2: Simulate (auto-fetches soil & weather)
     ========================================================== */
  $('[data-form="simulate"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="simulate"]');
    showLoading(out, 'Simulating yield, cost & profit…');
    try {
      const f = formToObj(e.target);
      // Respect user overrides: if farm boundary exists, use its soil;
      // if weather override is on, skip the API call entirely.
      const override = (window.__agrisimWeatherOverride && window.__agrisimWeatherOverride()) || null;
      const farmSoil = (window.__agrisimFarmSoil && window.__agrisimFarmSoil()) || null;
      const [soilRaw, weatherRaw] = await Promise.all([
        farmSoil ? Promise.resolve(farmSoil) : api(`/api/soil/${f.region_id}`).catch(() => ({})),
        override ? Promise.resolve(override) : api(`/api/weather/${f.region_id}?season=${f.season}`).catch(() => ({}))
      ]);
      // CSV rows come back as all-strings — coerce numerics so the simulator can do math.
      const coerce = obj => {
        const out = {};
        Object.entries(obj || {}).forEach(([k, v]) => {
          if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) out[k] = Number(v);
          else out[k] = v;
        });
        return out;
      };
      const soil = coerce(soilRaw);
      const weather = coerce(weatherRaw);
      const body = {
        crop_id: f.crop_id, region_id: f.region_id,
        area_acres: parseFloat(f.area_acres),
        mandi_price_per_kg: parseFloat(f.mandi_price_per_kg),
        irrigation_level: parseFloat(f.irrigation_level),
        seed_variety: 'standard', sowing_date: '2024-06-15',
        soil, weather,
        input_plan: {
          seed_cost_per_acre: +f.seed_cost_per_acre,
          fertilizer_cost_per_acre: +f.fertilizer_cost_per_acre,
          labour_cost_per_acre: +f.labour_cost_per_acre,
          irrigation_cost_per_acre: +f.other_costs_per_acre * 0.5,
          pesticide_cost_per_acre: +f.other_costs_per_acre * 0.3,
          machinery_cost_per_acre: +f.other_costs_per_acre * 0.2,
        }
      };
      const r = await api('/api/simulate', { method:'POST', body: JSON.stringify(body) });
      const area = body.area_acres;
      const yieldPerAc = r.yield_kg_per_acre || 0;
      const totalYield = r.total_yield_kg || yieldPerAc * area;
      const nut = r.nutrient_analysis || {};
      const water = r.water_efficiency || {};
      const sens = r.sensitivity || [];

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Total yield</div>
            <div class="kpi__val">${Math.round(totalYield)} <span style="font-size:.5em">kg</span></div>
            <div class="kpi__sub">${Math.round(yieldPerAc)} kg/ac</div></div>
          <div class="kpi"><div class="kpi__lbl">Revenue</div>
            <div class="kpi__val">${INR(r.revenue || 0)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Total cost</div>
            <div class="kpi__val">${INR(r.total_cost || 0)}</div>
            <div class="kpi__sub">Breakeven ₹${FIX(r.break_even_price_per_kg,1)}/kg</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Profit</div>
            <div class="kpi__val">${INR(r.profit || 0)}</div>
            <div class="kpi__sub">ROI ${PCT(r.roi_percent || 0)}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Risk score</div>
            <div class="kpi__val">${Math.round(r.risk_score || 0)}<span style="font-size:.5em;color:var(--ink-faint)">/100</span></div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Water / kg</div>
            <div class="kpi__val">${Math.round(water.water_per_kg_yield_liters || 0)} <span style="font-size:.5em">L</span></div>
            <div class="kpi__sub">${Math.round(water.irrigation_coverage_percent || 0)}% covered</div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Cost breakdown per acre</div>
            <canvas data-chart="sim-cost"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Revenue vs cost vs profit (total)</div>
            <canvas data-chart="sim-rev"></canvas>
          </div>
        </div>

        ${(nut.n_deficit !== undefined) ? `
        <div class="chart-box">
          <div class="chart-box__title">Nutrient balance · available vs required (kg/ac)</div>
          <canvas data-chart="sim-nut"></canvas>
        </div>` : ''}

        ${sens.length ? `
        <div class="chart-box">
          <div class="chart-box__title">Sensitivity · profit at varying price × yield (${sens.length} cells)</div>
          ${renderSensitivityHeatmap(sens, r.profit)}
        </div>` : ''}`;

      // Cost doughnut from actual backend breakdown
      const cb = r.cost_breakdown_per_acre || body.input_plan;
      const costKeys = Object.keys(cb);
      makeChart($('[data-chart="sim-cost"]'), {
        type: 'doughnut',
        data: {
          labels: costKeys.map(k => k.replace(/_cost_per_acre|_per_acre/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())),
          datasets: [{
            data: costKeys.map(k => cb[k]),
            backgroundColor: [BRAND, ACCENT, SKY, '#7ca894', CLAY, '#8a8376'],
            borderWidth: 2, borderColor: '#fff'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
                     tooltip: { callbacks: { label: c => c.label + ': ' + INR(c.parsed) + '/ac' } } }
        }
      });

      makeChart($('[data-chart="sim-rev"]'), {
        type: 'bar',
        data: {
          labels: ['Revenue', 'Total cost', 'Profit'],
          datasets: [{
            data: [r.revenue || 0, r.total_cost || 0, r.profit || 0],
            backgroundColor: [BRAND, CLAY, ACCENT], borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v/1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => INR(c.parsed.y) } } }
        }
      });

      if (nut.n_deficit !== undefined) {
        makeChart($('[data-chart="sim-nut"]'), {
          type: 'bar',
          data: {
            labels: ['Nitrogen (N)', 'Phosphorus (P)', 'Potassium (K)'],
            datasets: [
              { label: 'Available in soil', data: [nut.n_available || 0, nut.p_available || 0, nut.k_available || 0], backgroundColor: BRAND, borderRadius: 6 },
              { label: 'Required by crop', data: [nut.n_required || 0, nut.p_required || 0, nut.k_required || 0], backgroundColor: ACCENT, borderRadius: 6 }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => v + ' kg' } }, x: { grid: { display: false } } },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
          }
        });
      }
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 3: Rotation planner — top_rotations[]
     ========================================================== */
  $('[data-form="rotation"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="rotation"]');
    showLoading(out, 'Scoring kharif × rabi combinations…');
    try {
      const body = {
        region_id: formToObj(e.target).region_id,
        area_acres: parseFloat(formToObj(e.target).area_acres),
        budget_per_acre: parseFloat(formToObj(e.target).budget_per_acre)
      };
      const data = await api('/api/rotation-plan', { method: 'POST', body: JSON.stringify(body) });
      const plans = data.top_rotations || [];
      if (!plans.length) { out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No rotation plans.</strong></div></div>'; return; }

      const best = data.best_rotation || plans[0];
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Best rotation</div>
            <div class="kpi__val" style="font-size:1.15rem;">${cropLabel(best.kharif_crop)} → ${cropLabel(best.rabi_crop)}</div>
            <div class="kpi__sub">Score ${FIX(best.rotation_score || best.diversity_score || 0, 1)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Annual profit</div>
            <div class="kpi__val">${INR(best.annual_profit)}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Avg risk</div>
            <div class="kpi__val">${Math.round(best.avg_risk_score || 0)}<span style="font-size:.5em">/100</span></div></div>
        </div>

        <div class="chart-box">
          <div class="chart-box__title">Kharif vs rabi profit contribution (top 5)</div>
          <canvas data-chart="rot-bar"></canvas>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">All rotations</h4>
        ${plans.slice(0, 5).map((p, i) => `
          <div class="list-row">
            <div class="list-row__bullet">${i+1}</div>
            <div class="list-row__name">${cropLabel(p.kharif_crop)} → ${cropLabel(p.rabi_crop)}
              <small>Risk ${Math.round(p.avg_risk_score || 0)}/100 · Score ${FIX(p.rotation_score || p.diversity_score || 0, 1)}</small></div>
            <div class="list-row__val">${INR(p.annual_profit)}<small>per year</small></div>
          </div>`).join('')}`;

      // Stacked bar: kharif + rabi profit per rotation
      const top5 = plans.slice(0, 5);
      makeChart($('[data-chart="rot-bar"]'), {
        type: 'bar',
        data: {
          labels: top5.map(p => `${p.kharif_crop}→${p.rabi_crop}`),
          datasets: [
            { label: 'Kharif profit', data: top5.map(p => p.kharif_profit), backgroundColor: BRAND, borderRadius: 6 },
            { label: 'Rabi profit', data: top5.map(p => p.rabi_profit), backgroundColor: ACCENT, borderRadius: 6 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v/1000).toFixed(0) + 'K' } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 4: Price forecast — forecasts[] + historical via /mandi-prices
     ========================================================== */
  $('[data-form="forecast"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="forecast"]');
    showLoading(out, 'Forecasting mandi prices…');
    try {
      const f = formToObj(e.target);
      const months = parseInt(f.months_ahead) || 6;
      const [data, history] = await Promise.all([
        api(`/api/price-forecast/${f.region_id}/${f.crop_id}?months_ahead=${months}`),
        api(`/api/mandi-prices/${f.region_id}?crop_id=${f.crop_id}`).catch(() => [])
      ]);
      const fcst = data.forecasts || [];
      if (!fcst.length) { out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No forecast available.</strong></div></div>'; return; }

      // Build historical series (last 12 rows sorted by date)
      const histSorted = history
        .map(h => ({ date: h.date || h.price_date, price: parseFloat(h.price_inr_per_kg || h.price || 0) }))
        .filter(h => h.date && !isNaN(h.price))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-12);

      const histLabels = histSorted.map(h => h.date.slice(0, 7));
      const histData = histSorted.map(h => h.price);
      const fcstLabels = fcst.map(fo => fo.month);
      const fcstData = fcst.map(fo => fo.forecast_price);

      // Combined series: history followed by forecast (padded with nulls so they align on same chart)
      const combinedLabels = [...histLabels, ...fcstLabels];
      const histPad = [...histData, ...fcstLabels.map(() => null)];
      const fcstPad = [...histLabels.slice(0, -1).map(() => null),
                        histData.length ? histData[histData.length - 1] : null,
                        ...fcstData];

      const lastHist = histData[histData.length - 1] || data.current_price || 0;
      const lastFcst = fcstData[fcstData.length - 1] || 0;
      const deltaPct = lastHist ? ((lastFcst - lastHist) / lastHist) * 100 : 0;

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi__lbl">Current price</div>
            <div class="kpi__val">${INR(data.current_price)}<span style="font-size:.5em">/kg</span></div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">+${months} mo forecast</div>
            <div class="kpi__val">${INR(lastFcst)}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub"><span class="chip ${deltaPct >= 0 ? 'chip--green' : 'chip--red'}">${deltaPct >= 0 ? '+' : ''}${FIX(deltaPct, 1)}% vs now</span></div></div>
          <div class="kpi ${data.trend_direction === 'rising' ? 'kpi--good' : data.trend_direction === 'falling' ? 'kpi--warn' : 'kpi--info'}">
            <div class="kpi__lbl">Trend</div>
            <div class="kpi__val" style="font-size:1.3rem;text-transform:capitalize;">${data.trend_direction || '—'}</div>
            <div class="kpi__sub">Slope ${FIX(data.trend_slope_per_month || 0, 2)}/mo</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Model</div>
            <div class="kpi__val" style="font-size:1rem;">${data.prediction_source || 'ml_model'}</div>
            <div class="kpi__sub">${fcst[0]?.confidence || 'high'} confidence</div></div>
        </div>

        <div class="chart-box">
          <div class="chart-box__title">Price trajectory · ${f.crop_id} @ ${f.region_id}</div>
          <canvas data-chart="fcst-line"></canvas>
        </div>`;

      makeChart($('[data-chart="fcst-line"]'), {
        type: 'line',
        data: {
          labels: combinedLabels,
          datasets: [
            {
              label: 'Historical',
              data: histPad,
              borderColor: BRAND,
              backgroundColor: BRAND + '20',
              borderWidth: 2.5,
              pointRadius: 3,
              pointBackgroundColor: BRAND,
              tension: 0.3,
              fill: true,
              spanGaps: false
            },
            {
              label: 'ML forecast',
              data: fcstPad,
              borderColor: ACCENT,
              backgroundColor: ACCENT + '20',
              borderWidth: 2.5,
              borderDash: [6, 4],
              pointRadius: 3,
              pointBackgroundColor: ACCENT,
              tension: 0.3,
              fill: true,
              spanGaps: false
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: { beginAtZero: false, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + v } },
            x: { grid: { display: false } }
          },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ₹' + FIX(c.parsed.y, 2) + '/kg' } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 5: MSP vs Market
     ========================================================== */
  $('[data-form="msp"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="msp"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/msp-vs-market/${f.region_id}/${f.crop_id}`);
      const gap = r.mandi_msp_gap_pct || 0;
      const cls = r.mandi_above_msp ? 'chip--green' : 'chip--red';

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi__lbl">MSP (${r.msp_year})</div>
            <div class="kpi__val">${INR(r.msp_inr_per_kg)}<span style="font-size:.5em">/kg</span></div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Current mandi</div>
            <div class="kpi__val">${INR(r.current_mandi_price)}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub"><span class="chip ${cls}">${r.mandi_above_msp ? '+' : ''}${FIX(gap, 1)}% vs MSP</span></div></div>
          <div class="kpi"><div class="kpi__lbl">6-month avg</div>
            <div class="kpi__val">${INR(r.avg_mandi_6m)}<span style="font-size:.5em">/kg</span></div></div>
        </div>
        <div class="chart-box">
          <div class="chart-box__title">Price comparison</div>
          <canvas data-chart="msp-bar"></canvas>
        </div>
        <div class="alert alert--${r.mandi_above_msp ? 'green' : 'gold'}">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="alert__body"><strong>Recommendation</strong><p>${r.recommendation}</p></div>
        </div>`;

      makeChart($('[data-chart="msp-bar"]'), {
        type: 'bar',
        data: {
          labels: ['MSP', '6-month avg', 'Current mandi'],
          datasets: [{
            data: [r.msp_inr_per_kg, r.avg_mandi_6m, r.current_mandi_price],
            backgroundColor: [CLAY, SKY, BRAND], borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: { x: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + v } }, y: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 6: Sell advisor
     ========================================================== */
  $('[data-form="sell"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="sell"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/sell-advisor/${f.region_id}/${f.crop_id}`);
      const action = (r.action || '').toLowerCase();
      const cls = action.includes('hold') ? 'kpi--warn' : action.includes('sell') ? 'kpi--good' : 'kpi--info';
      const alertCls = action.includes('hold') ? 'alert--gold' : action.includes('sell') ? 'alert--green' : 'alert--gold';
      const monthly = r.monthly_avg_prices || {};
      const monthEntries = Object.entries(monthly).map(([m, p]) => ({ m: parseInt(m), p: parseFloat(p) })).sort((a, b) => a.m - b.m);

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi ${cls}"><div class="kpi__lbl">Action</div>
            <div class="kpi__val" style="font-size:1.4rem;text-transform:uppercase;">${r.action || '—'}</div></div>
          <div class="kpi"><div class="kpi__lbl">Current price</div>
            <div class="kpi__val">${INR(r.current_price)}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub">${MONTH_NAMES[r.current_month] || ''}</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Best month</div>
            <div class="kpi__val" style="font-size:1.3rem;">${MONTH_NAMES[r.best_month] || '—'}</div>
            <div class="kpi__sub">${INR(r.best_month_avg_price)}/kg</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Worst month</div>
            <div class="kpi__val" style="font-size:1.3rem;">${MONTH_NAMES[r.worst_month] || '—'}</div>
            <div class="kpi__sub">${INR(r.worst_month_avg_price)}/kg</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Gain if held</div>
            <div class="kpi__val">${FIX(r.potential_gain_pct || 0, 1)}%</div>
            <div class="kpi__sub">${r.months_to_peak} mo to peak</div></div>
        </div>

        ${monthEntries.length ? `<div class="chart-box">
          <div class="chart-box__title">Seasonal price pattern (12-month average)</div>
          <canvas data-chart="sell-line"></canvas>
        </div>` : ''}

        <div class="alert ${alertCls}">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="alert__body"><strong>Advice</strong><p>${r.advice}</p></div>
        </div>`;

      if (monthEntries.length) {
        makeChart($('[data-chart="sell-line"]'), {
          type: 'line',
          data: {
            labels: monthEntries.map(e => MONTH_NAMES[e.m]),
            datasets: [{
              label: 'Avg price',
              data: monthEntries.map(e => e.p),
              borderColor: BRAND,
              backgroundColor: BRAND + '25',
              borderWidth: 2.5, tension: 0.4, fill: true,
              pointRadius: monthEntries.map(e => e.m === r.best_month ? 6 : e.m === r.worst_month ? 6 : 3),
              pointBackgroundColor: monthEntries.map(e => e.m === r.best_month ? BRAND : e.m === r.worst_month ? CLAY : BRAND),
              pointBorderColor: '#fff', pointBorderWidth: 2
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + v } }, x: { grid: { display: false } } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => '₹' + FIX(c.parsed.y, 2) + '/kg' } } }
          }
        });
      }
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 7: Arbitrage — cheapest_market / costliest_market / opportunities
     ========================================================== */
  $('[data-form="arbitrage"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="arbitrage"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/arbitrage/${f.crop_id}`);
      const cheapest = r.cheapest_market || {};
      const costliest = r.costliest_market || {};
      const opps = r.opportunities || [];

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Sell high</div>
            <div class="kpi__val" style="font-size:1.1rem;">${costliest.market_name || costliest.region_id || '—'}</div>
            <div class="kpi__sub">${INR(costliest.price_inr_per_kg || 0)}/kg</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Buy low</div>
            <div class="kpi__val" style="font-size:1.1rem;">${cheapest.market_name || cheapest.region_id || '—'}</div>
            <div class="kpi__sub">${INR(cheapest.price_inr_per_kg || 0)}/kg</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Max spread</div>
            <div class="kpi__val">${INR(r.max_price_gap_per_kg)}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub">${FIX(r.max_gap_pct, 1)}% · ${r.regions_compared} mandis</div></div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Arbitrage opportunities</h4>
        ${opps.map(op => `
          <div class="alert alert--green">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17l10-10M17 7v10h-10"/></svg>
            <div class="alert__body">
              <strong>${op.buy_market} → ${op.sell_market}</strong>
              <p>Buy @ ${INR(op.buy_price)}/kg, sell @ ${INR(op.sell_price)}/kg · Gap <span class="chip chip--green">+${INR(op.price_gap_per_kg)} (${FIX(op.gap_pct, 1)}%)</span></p>
            </div></div>`).join('')}

        <div class="alert"><div class="alert__body"><p style="font-size:.82rem;">${r.note || ''}</p></div></div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 8: Crop calendar — calendar is a DICT of named activities
     ========================================================== */
  $('[data-form="calendar"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="calendar"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/crop-calendar/${f.crop_id}?season=${f.season}`);
      const cal = r.calendar || null;
      if (!cal) {
        out.innerHTML = `<div class="alert alert--gold"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="alert__body"><strong>No calendar data yet for ${cropLabel(f.crop_id)}</strong><p>This crop was recently added. Calendar data will be populated in a future update. Meanwhile, check the <a href="#" onclick="document.querySelector('.sidebar__btn[data-tool=irrigation]').click();return false;" style="color:var(--brand);font-weight:600;">irrigation schedule</a> for timing.</p></div></div>`;
        return;
      }
      const LABELS = {
        nursery: 'Nursery preparation', land_preparation: 'Land preparation',
        sowing: 'Sowing', sowing_transplant: 'Sowing / transplanting', sowing_window: 'Sowing window',
        first_fertilizer: 'First fertilizer', second_fertilizer: 'Second fertilizer', third_fertilizer: 'Third fertilizer',
        basal_fertilizer: 'Basal fertilizer', top_dress_fertilizer: 'Top-dress fertilizer',
        critical_irrigation: 'Critical irrigation', pest_watch: 'Pest watch',
        flowering: 'Flowering', harvest_window: 'Harvest window', harvest: 'Harvest',
        duration_days: 'Total duration'
      };
      const entries = Object.entries(cal).filter(([k, v]) => k !== 'duration_days' && v);

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--info"><div class="kpi__lbl">Duration</div>
            <div class="kpi__val">${cal.duration_days || '—'} <span style="font-size:.5em">days</span></div></div>
          <div class="kpi"><div class="kpi__lbl">Sowing</div>
            <div class="kpi__val" style="font-size:1.05rem;">${cal.sowing_transplant || cal.sowing_window || cal.sowing || '—'}</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Harvest</div>
            <div class="kpi__val" style="font-size:1.05rem;">${cal.harvest_window || cal.harvest || '—'}</div></div>
        </div>
        <div class="timeline">
          ${entries.map(([k, v]) => `
            <div class="timeline__item">
              <div class="timeline__date">${LABELS[k] || k.replace(/_/g, ' ')}</div>
              <div class="timeline__title">${v}</div>
            </div>`).join('')}
        </div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 9: Irrigation — weekly_schedule[], priority field
     ========================================================== */
  $('[data-form="irrigation"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="irrigation"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const q = new URLSearchParams({ sowing_date: f.sowing_date, rainfall_mm: f.rainfall_mm, irrigation_level: f.irrigation_level }).toString();
      const r = await api(`/api/irrigation-schedule/${f.crop_id}?${q}`);
      const schedule = r.weekly_schedule || [];
      const criticalCount = schedule.filter(s => (s.priority || '').toLowerCase() === 'high').length;

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--info"><div class="kpi__lbl">Total water need</div>
            <div class="kpi__val">${Math.round(r.total_water_requirement_mm || 0)} <span style="font-size:.5em">mm</span></div></div>
          <div class="kpi"><div class="kpi__lbl">Rainfall</div>
            <div class="kpi__val">${Math.round(r.total_seasonal_rainfall_mm || 0)} <span style="font-size:.5em">mm</span></div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Irrigation needed</div>
            <div class="kpi__val">${Math.round(r.total_irrigation_needed_mm || 0)} <span style="font-size:.5em">mm</span></div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Critical weeks</div>
            <div class="kpi__val">${criticalCount}<span style="font-size:.5em;color:var(--ink-faint)">/${schedule.length}</span></div></div>
        </div>

        <div class="chart-box">
          <div class="chart-box__title">Water need vs rainfall · week by week</div>
          <canvas data-chart="irr-bar"></canvas>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Weekly schedule</h4>
        ${schedule.map(s => {
          const high = (s.priority || '').toLowerCase() === 'high';
          return `<div class="list-row" style="${high ? 'background:var(--accent-soft);' : ''}">
            <div class="list-row__bullet" style="background:${high ? 'var(--accent)' : 'var(--sky)'};">${s.week}</div>
            <div class="list-row__name">Week ${s.week} · ${s.growth_stage}
              <small>${s.date_range} · need ${Math.round(s.water_need_mm)}mm, rain ${Math.round(s.expected_rainfall_mm)}mm</small></div>
            <div class="list-row__val">${Math.round(s.irrigation_required_mm)} mm<small>${s.priority}</small></div>
          </div>`;
        }).join('')}`;

      makeChart($('[data-chart="irr-bar"]'), {
        type: 'bar',
        data: {
          labels: schedule.map(s => 'W' + s.week),
          datasets: [
            { label: 'Water need', data: schedule.map(s => s.water_need_mm), backgroundColor: BRAND, borderRadius: 4 },
            { label: 'Rainfall', data: schedule.map(s => s.expected_rainfall_mm), backgroundColor: SKY, borderRadius: 4 },
            { label: 'Irrigation required', data: schedule.map(s => s.irrigation_required_mm), backgroundColor: ACCENT, borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => v + 'mm' } }, x: { grid: { display: false } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 10: Fertilizer — deficit_npk dict, recommendations[]
     ========================================================== */
  $('[data-form="fertilizer"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="fertilizer"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/fertilizer-recommendation/${f.crop_id}?n=${f.n}&p=${f.p}&k=${f.k}`);
      const def = r.deficit_npk || {};
      const recs = r.recommendations || [];
      const deficitN = def.n_kg_per_acre ?? def.n ?? 0;
      const deficitP = def.p_kg_per_acre ?? def.p ?? 0;
      const deficitK = def.k_kg_per_acre ?? def.k ?? 0;

      out.innerHTML = `
        <div class="kpi-grid">
          ${[['N', deficitN], ['P', deficitP], ['K', deficitK]].map(([k, gap]) =>
            `<div class="kpi ${gap > 0 ? 'kpi--warn' : 'kpi--good'}">
              <div class="kpi__lbl">${k} deficit</div>
              <div class="kpi__val">${gap > 0 ? '' : '+'}${Math.round(-gap)} <span style="font-size:.5em">kg/ac</span></div>
              <div class="kpi__sub">${gap > 0 ? 'Needs ' + Math.round(gap) + ' kg' : 'Sufficient'}</div>
            </div>`).join('')}
          <div class="kpi kpi--info"><div class="kpi__lbl">Total cost</div>
            <div class="kpi__val">${INR(r.total_fertilizer_cost_per_acre)}</div>
            <div class="kpi__sub">per acre</div></div>
        </div>

        ${recs.length ? `<div class="chart-box">
          <div class="chart-box__title">Fertilizer cost breakdown</div>
          <canvas data-chart="fert-doughnut"></canvas>
        </div>` : ''}

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Application plan</h4>
        ${recs.length ? recs.map(f => `
          <div class="list-row">
            <div class="list-row__bullet">✓</div>
            <div class="list-row__name">${f.fertilizer} <span class="chip">${f.grade}</span>
              <small>${f.nutrient_supplied} · ${f.application_timing}</small></div>
            <div class="list-row__val">${Math.round(f.quantity_kg_per_acre)} kg<small>${INR(f.cost_inr)}/ac</small></div>
          </div>`).join('') : '<div class="alert alert--green"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg><div class="alert__body"><strong>Soil is balanced</strong><p>No major fertilizer needed.</p></div></div>'}

        <div class="alert"><div class="alert__body"><p style="font-size:.82rem;">${r.note || ''}</p></div></div>`;

      if (recs.length) {
        makeChart($('[data-chart="fert-doughnut"]'), {
          type: 'doughnut',
          data: {
            labels: recs.map(f => f.fertilizer.split(' ')[0]),
            datasets: [{ data: recs.map(f => f.cost_inr), backgroundColor: [BRAND, ACCENT, SKY, CLAY, '#7ca894'], borderWidth: 2, borderColor: '#fff' }]
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: '62%',
            plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8 } }, tooltip: { callbacks: { label: c => c.label + ': ' + INR(c.parsed) + '/ac' } } }
          }
        });
      }
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 11: Pest alerts — alerts[] with pest_disease/risk_level/severity
     ========================================================== */
  $('[data-form="pest"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="pest"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/pest-alerts/${f.crop_id}?avg_temp_c=${f.avg_temp_c}&rainfall_mm=${f.rainfall_mm}`);
      const alerts = r.alerts || [];

      if (!alerts.length) {
        out.innerHTML = `<div class="alert alert--green">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
          <div class="alert__body"><strong>No active pest risk</strong><p>Current weather (${f.avg_temp_c}°C, ${f.rainfall_mm}mm) is safe for ${f.crop_id}.</p></div></div>`;
        return;
      }

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--warn"><div class="kpi__lbl">Total alerts</div>
            <div class="kpi__val">${r.total_alerts || alerts.length}</div></div>
          <div class="kpi kpi--${r.high_risk_count > 0 ? 'warn' : 'good'}"><div class="kpi__lbl">High risk</div>
            <div class="kpi__val">${r.high_risk_count || 0}</div></div>
          <div class="kpi"><div class="kpi__lbl">Conditions</div>
            <div class="kpi__val" style="font-size:1.1rem;">${r.temperature_c}°C · ${r.rainfall_mm}mm</div></div>
        </div>

        ${alerts.map(a => {
          const sev = (a.severity || a.risk_level || '').toLowerCase();
          const cls = sev.includes('high') ? 'alert--red' : sev.includes('moderate') || sev.includes('medium') ? 'alert--gold' : 'alert--green';
          const chipCls = cls === 'alert--red' ? 'chip--red' : cls === 'alert--gold' ? 'chip--gold' : 'chip--green';
          return `<div class="alert ${cls}">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
            <div class="alert__body">
              <strong>${a.pest_disease} <span class="chip ${chipCls}">${a.risk_level || a.severity}</span></strong>
              <p>${a.description || ''}</p>
              <p style="font-size:.82rem;margin-top:4px;color:var(--ink-faint);"><strong>Trigger:</strong> ${a.trigger || ''} · <strong>Now:</strong> ${a.current_conditions || ''}</p>
              ${a.management || a.treatment ? `<p style="margin-top:6px;"><strong>Action:</strong> ${a.management || a.treatment}</p>` : ''}
            </div></div>`;
        }).join('')}`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 12: Loan — debt_service_coverage_ratio, kcc_note
     ========================================================== */
  $('[data-form="loan"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="loan"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const body = {
        total_cost: +f.total_cost, expected_profit: +f.expected_profit,
        loan_amount: +f.loan_amount, interest_rate_annual: +f.interest_rate_annual,
        tenure_months: +f.tenure_months
      };
      const r = await api('/api/loan-calculator', { method: 'POST', body: JSON.stringify(body) });
      const v = (r.verdict || '').toLowerCase();
      const cls = v.includes('safe') ? 'kpi--good' : v.includes('moderate') ? 'kpi--warn' : 'kpi--info';
      const dscr = r.debt_service_coverage_ratio || 0;

      // Build repayment schedule (principal + interest over tenure)
      const n = r.tenure_months, P = r.loan_amount, emi = r.emi;
      const monthlyRate = (r.interest_rate_annual_pct || 0) / 12 / 100;
      let balance = P;
      const principalArr = [], interestArr = [], balanceArr = [];
      for (let i = 0; i < n; i++) {
        const int = balance * monthlyRate;
        const prin = emi - int;
        balance = Math.max(0, balance - prin);
        principalArr.push(prin); interestArr.push(int); balanceArr.push(balance);
      }

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi ${cls}"><div class="kpi__lbl">Verdict</div>
            <div class="kpi__val" style="font-size:1.1rem;">${r.verdict.split('—')[0].trim()}</div>
            <div class="kpi__sub">DSCR ${FIX(dscr, 2)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Monthly EMI</div>
            <div class="kpi__val">${INR(r.emi)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Total repayment</div>
            <div class="kpi__val">${INR(r.total_repayment)}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Total interest</div>
            <div class="kpi__val">${INR(r.total_interest)}</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Breakeven</div>
            <div class="kpi__val">${r.breakeven_months} <span style="font-size:.5em">mo</span></div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Principal vs interest per month</div>
            <canvas data-chart="loan-stack"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Outstanding balance</div>
            <canvas data-chart="loan-balance"></canvas>
          </div>
        </div>

        <div class="alert alert--${cls === 'kpi--good' ? 'green' : 'gold'}">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
          <div class="alert__body"><strong>${r.verdict}</strong><p>${r.kcc_note || ''}</p></div>
        </div>`;

      const labels = Array.from({ length: n }, (_, i) => 'M' + (i + 1));
      makeChart($('[data-chart="loan-stack"]'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Principal', data: principalArr, backgroundColor: BRAND, borderRadius: 4 },
            { label: 'Interest', data: interestArr, backgroundColor: ACCENT, borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(1) + 'K' } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
      makeChart($('[data-chart="loan-balance"]'), {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Balance', data: balanceArr, borderColor: CLAY,
            backgroundColor: CLAY + '20', borderWidth: 2.5, tension: 0.3, fill: true, pointRadius: 0
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 13: Govt schemes — eligible_schemes[]
     ========================================================== */
  $('[data-form="schemes"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="schemes"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const q = new URLSearchParams({
        crop_id: f.crop_id || 'all',
        season: f.season || 'all',
        area_acres: f.area_acres || 3,
        region_id: 'all'
      }).toString();
      const r = await api(`/api/government-schemes?${q}`);
      const schemes = r.eligible_schemes || [];
      if (!schemes.length) {
        out.innerHTML = `<div class="alert"><div class="alert__body"><strong>No matching schemes</strong><p>Try widening the filters.</p></div></div>`;
        return;
      }
      out.innerHTML = `
        <div style="margin-bottom:16px;"><span class="chip chip--green">${r.total_matched} eligible schemes</span></div>
        ${schemes.map(s => `
          <div class="alert alert--green">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M9 15l2 2 4-4"/></svg>
            <div class="alert__body">
              <strong>${s.scheme_name} ${s.benefit_type ? `<span class="chip chip--gold">${s.benefit_type}</span>` : ''}</strong>
              <p>${s.description || ''}</p>
              ${s.benefit_value ? `<p style="margin-top:4px;"><strong>Benefit:</strong> ${s.benefit_value}</p>` : ''}
              ${(s.url || s.application_url) ? `<p style="margin-top:6px;"><a href="${s.url || s.application_url}" target="_blank" rel="noopener" style="color:var(--brand);font-weight:600;">Apply →</a></p>` : ''}
            </div></div>`).join('')}`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 15: Strategy templates
     ========================================================== */
  $('[data-form="templates"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="templates"]');
    showLoading(out, 'Loading templates…');
    try {
      const profile = formToObj(e.target).profile;
      const url = profile ? `/api/strategy-templates?profile=${profile}` : '/api/strategy-templates';
      const list = await api(url);
      if (!Array.isArray(list) || !list.length) {
        out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No templates found.</strong></div></div>';
        return;
      }
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Templates</div>
            <div class="kpi__val">${list.length}</div>
            <div class="kpi__sub">${profile ? profile + ' profile' : 'All profiles'}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">
          ${list.map(t => {
            const c = t.config || {};
            return `<div style="background:var(--bg-soft);padding:18px;border-radius:var(--r-md);display:flex;flex-direction:column;gap:10px;">
              <div>
                <div style="font-family:'Fraunces',serif;font-size:1.15rem;font-weight:600;line-height:1.2;">${t.name || t.template_id}</div>
                <div style="font-size:.82rem;color:var(--ink-faint);margin-top:3px;">${t.template_id}</div>
              </div>
              <p style="font-size:.9rem;color:var(--ink-soft);margin:0;flex:1;">${t.description || ''}</p>
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${c.crop_id ? `<span class="chip chip--green">${cropLabel(c.crop_id)}</span>` : ''}
                ${c.season ? `<span class="chip">${c.season}</span>` : ''}
                ${c.area_acres ? `<span class="chip">${c.area_acres} ac</span>` : ''}
                ${c.irrigation_level !== undefined ? `<span class="chip chip--blue">irrig ${c.irrigation_level}</span>` : ''}
                ${c.budget_per_acre ? `<span class="chip chip--gold">${INR(c.budget_per_acre)}/ac</span>` : ''}
              </div>
              <div style="font-size:.78rem;color:var(--ink-faint);border-top:1px dashed rgba(29,26,21,.1);padding-top:8px;">${t.profile || ''}</div>
              <button class="btn btn-ghost" data-apply-template='${JSON.stringify(t).replace(/'/g, "&#39;")}' style="padding:8px 14px;font-size:.85rem;">Use in simulator →</button>
            </div>`;
          }).join('')}
        </div>`;

      // Wire up "Use in simulator" buttons → prefill Yield & Profit form
      out.querySelectorAll('[data-apply-template]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tpl = JSON.parse(btn.dataset.applyTemplate.replace(/&#39;/g, "'"));
          const c = tpl.config || {};
          const simForm = document.querySelector('[data-form="simulate"]');
          if (!simForm) return;
          if (c.crop_id) simForm.crop_id.value = c.crop_id;
          if (c.season) simForm.season.value = c.season;
          if (c.area_acres !== undefined) simForm.area_acres.value = c.area_acres;
          if (c.irrigation_level !== undefined) simForm.irrigation_level.value = c.irrigation_level;
          if (c.budget_per_acre) {
            simForm.seed_cost_per_acre.value = Math.round(c.budget_per_acre * 0.12);
            simForm.fertilizer_cost_per_acre.value = Math.round(c.budget_per_acre * 0.30);
            simForm.labour_cost_per_acre.value = Math.round(c.budget_per_acre * 0.25);
            simForm.other_costs_per_acre.value = Math.round(c.budget_per_acre * 0.33);
          }
          // Switch to simulate tab
          document.querySelector('.sidebar__btn[data-tool="simulate"]')?.click();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 16: Compare crops (batch-simulate)
     ========================================================== */
  $('[data-form="compare"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="compare"]');
    const form = e.target;
    // Pull multi-select values directly (FormData gives only one value)
    const selected = Array.from(form.crop_ids.selectedOptions).map(o => o.value);
    if (selected.length < 2) {
      out.innerHTML = '<div class="alert alert--gold"><div class="alert__body"><strong>Pick at least 2 crops</strong><p>Hold Ctrl / Cmd and click to select multiple.</p></div></div>';
      return;
    }
    showLoading(out, `Simulating ${selected.length} crops in parallel…`);
    try {
      const f = formToObj(form);
      const [soilRaw, weatherRaw] = await Promise.all([
        api(`/api/soil/${f.region_id}`).catch(() => ({})),
        api(`/api/weather/${f.region_id}?season=${f.season}`).catch(() => ({}))
      ]);
      const coerce = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) =>
        [k, (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) ? Number(v) : v]));

      const body = {
        crop_ids: selected,
        area_acres: parseFloat(f.area_acres),
        region_id: f.region_id,
        budget_per_acre: parseFloat(f.budget_per_acre),
        irrigation_level: parseFloat(f.irrigation_level),
        seed_variety: 'standard', sowing_date: '2024-06-15',
        soil: coerce(soilRaw),
        weather: coerce(weatherRaw)
      };
      const data = await api('/api/batch-simulate', { method: 'POST', body: JSON.stringify(body) });
      const results = data.results || [];
      if (!results.length) {
        out.innerHTML = '<div class="alert alert--red"><div class="alert__body"><strong>No results</strong><p>' + (data.errors?.[0]?.error || 'Batch simulation returned nothing.') + '</p></div></div>';
        return;
      }

      const best = results[0];
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Winner</div>
            <div class="kpi__val" style="font-size:1.25rem;">${cropLabel(best.crop_id)}</div>
            <div class="kpi__sub">Profit ${INR(best.profit)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Best ROI</div>
            <div class="kpi__val">${PCT(Math.max(...results.map(r => r.roi_percent)))}</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Crops simulated</div>
            <div class="kpi__val">${data.total_simulated}</div>
            <div class="kpi__sub">${data.errors?.length ? data.errors.length + ' errors' : 'all succeeded'}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Profit spread</div>
            <div class="kpi__val">${INR(best.profit - results[results.length - 1].profit)}</div>
            <div class="kpi__sub">winner − loser</div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Profit ranking</div>
            <canvas data-chart="cmp-profit"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Profit vs risk</div>
            <canvas data-chart="cmp-scatter"></canvas>
          </div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Detailed comparison</h4>
        ${results.map((r, i) => `
          <div class="list-row">
            <div class="list-row__bullet" style="background:${i === 0 ? BRAND : i === results.length - 1 ? CLAY : 'var(--ink-faint)'};">${i + 1}</div>
            <div class="list-row__name">${cropLabel(r.crop_id)}
              <small>Yield ${Math.round(r.yield_kg_per_acre)} kg/ac · Risk ${Math.round(r.risk_score)}/100 · Revenue ${INR(r.revenue)}</small></div>
            <div class="list-row__val">${INR(r.profit)}<small>ROI ${PCT(r.roi_percent)}</small></div>
          </div>`).join('')}`;

      makeChart($('[data-chart="cmp-profit"]'), {
        type: 'bar',
        data: {
          labels: results.map(r => CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id),
          datasets: [{
            label: 'Profit',
            data: results.map(r => r.profit),
            backgroundColor: results.map((_, i) => i === 0 ? BRAND : i === results.length - 1 ? CLAY : ACCENT),
            borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: { x: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, y: { grid: { display: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => INR(c.parsed.x) } } }
        }
      });

      makeChart($('[data-chart="cmp-scatter"]'), {
        type: 'scatter',
        data: {
          datasets: results.map((r, i) => ({
            label: CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id,
            data: [{ x: r.risk_score, y: r.profit }],
            backgroundColor: [BRAND, ACCENT, SKY, CLAY, '#7ca894', '#8a8376'][i % 6],
            pointRadius: 10, pointHoverRadius: 13, borderWidth: 2, borderColor: '#fff'
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { title: { display: true, text: 'Risk score (lower is better) →' }, min: 0, max: 100, grid: { color: 'rgba(29,26,21,.06)' } },
            y: { title: { display: true, text: '↑ Profit' }, beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }
          },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8 } },
            tooltip: { callbacks: { label: c => c.dataset.label + ': risk ' + c.parsed.x.toFixed(0) + ', profit ' + INR(c.parsed.y) } }
          }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 17: Optimal crop mix
     ========================================================== */
  $('[data-form="mix"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="mix"]');
    showLoading(out, 'Optimising allocation across crops…');
    try {
      const f = formToObj(e.target);
      const [soilRaw, weatherRaw] = await Promise.all([
        api(`/api/soil/${f.region_id}`).catch(() => ({})),
        api(`/api/weather/${f.region_id}?season=${f.season}`).catch(() => ({}))
      ]);
      const coerce = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) =>
        [k, (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) ? Number(v) : v]));

      const body = {
        region_id: f.region_id,
        season: f.season,
        total_area_acres: parseFloat(f.total_area_acres),
        total_budget: parseFloat(f.total_budget),
        soil: coerce(soilRaw),
        weather: coerce(weatherRaw)
      };
      const r = await api('/api/optimal-mix', { method: 'POST', body: JSON.stringify(body) });
      const allocs = r.allocations || [];
      if (!allocs.length) {
        out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No allocations returned.</strong></div></div>';
        return;
      }

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Total profit</div>
            <div class="kpi__val">${INR(r.total_expected_profit)}</div>
            <div class="kpi__sub">across ${r.num_crops} crops</div></div>
          <div class="kpi"><div class="kpi__lbl">Land allocated</div>
            <div class="kpi__val">${allocs.reduce((s, a) => s + a.allocated_acres, 0).toFixed(1)}<span style="font-size:.5em"> / ${r.total_area_acres} ac</span></div></div>
          <div class="kpi"><div class="kpi__lbl">Budget used</div>
            <div class="kpi__val">${INR(allocs.reduce((s, a) => s + a.allocated_budget, 0))}<span style="font-size:.5em"> / ${INR(r.total_budget)}</span></div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Avg risk</div>
            <div class="kpi__val">${Math.round(r.avg_risk_score || 0)}<span style="font-size:.5em;color:var(--ink-faint)">/100</span></div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Land allocation (acres)</div>
            <canvas data-chart="mix-land"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Profit contribution</div>
            <canvas data-chart="mix-profit"></canvas>
          </div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Detailed allocation</h4>
        ${allocs.map((a, i) => `
          <div class="list-row">
            <div class="list-row__bullet">${i + 1}</div>
            <div class="list-row__name">${cropLabel(a.crop_id)}
              <small>${a.allocated_acres} ac · Budget ${INR(a.allocated_budget)} · Risk ${Math.round(a.risk_score)}/100</small></div>
            <div class="list-row__val">${INR(a.expected_profit)}<small>ROI ${PCT(a.roi_percent)}</small></div>
          </div>`).join('')}`;

      const palette = [BRAND, ACCENT, SKY, CLAY, '#7ca894', '#8a8376', '#d4a64a', '#6ea7c7'];
      makeChart($('[data-chart="mix-land"]'), {
        type: 'doughnut',
        data: {
          labels: allocs.map(a => CROP_LABELS[a.crop_id]?.split(' ·')[0] || a.crop_id),
          datasets: [{ data: allocs.map(a => a.allocated_acres), backgroundColor: palette, borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8 } }, tooltip: { callbacks: { label: c => c.label + ': ' + c.parsed + ' ac' } } }
        }
      });
      makeChart($('[data-chart="mix-profit"]'), {
        type: 'bar',
        data: {
          labels: allocs.map(a => CROP_LABELS[a.crop_id]?.split(' ·')[0] || a.crop_id),
          datasets: [{ data: allocs.map(a => a.expected_profit), backgroundColor: palette, borderRadius: 8, borderSkipped: false }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => INR(c.parsed.y) } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 14: ML status / retrain
     ========================================================== */
  $('[data-action="ml-status"]').addEventListener('click', async () => {
    const out = $('[data-out="ml"]');
    showLoading(out, 'Checking model status…');
    try {
      const r = await api('/api/ml/status');
      const m = r.training_report || {};
      const my = m.yield_model || m.yield || {};
      const mp = m.price_model || m.price || {};
      const mr = m.recommend_model || m.recommend || {};
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi ${r.yield_model_loaded ? 'kpi--good' : 'kpi--warn'}">
            <div class="kpi__lbl">Yield model</div>
            <div class="kpi__val">${r.yield_model_loaded ? '✓ Loaded' : '— Offline'}</div>
            ${my.r2 !== undefined ? `<div class="kpi__sub">R² ${FIX(my.r2, 3)} · MAE ${Math.round(my.mae || 0)}kg</div>` : ''}</div>
          <div class="kpi ${r.price_model_loaded ? 'kpi--good' : 'kpi--warn'}">
            <div class="kpi__lbl">Price model</div>
            <div class="kpi__val">${r.price_model_loaded ? '✓ Loaded' : '— Offline'}</div>
            ${mp.r2 !== undefined ? `<div class="kpi__sub">R² ${FIX(mp.r2, 3)} · MAE ₹${FIX(mp.mae, 1)}</div>` : ''}</div>
          <div class="kpi ${r.recommend_model_loaded ? 'kpi--good' : 'kpi--warn'}">
            <div class="kpi__lbl">Recommend model</div>
            <div class="kpi__val">${r.recommend_model_loaded ? '✓ Loaded' : '— Offline'}</div>
            ${mr.accuracy !== undefined ? `<div class="kpi__sub">Accuracy ${PCT(mr.accuracy * 100)}</div>` : ''}</div>
        </div>
        <div class="alert"><div class="alert__body">
          <strong>Model directory</strong>
          <p style="font-family:monospace;font-size:.82rem;word-break:break-all;">${r.model_dir}</p>
        </div></div>`;
    } catch (err) { showError(out, err); }
  });
  $('[data-action="ml-train"]').addEventListener('click', async () => {
    if (!confirm('Retrain all 3 ML models? This takes 20–40 seconds.')) return;
    const out = $('[data-out="ml"]');
    showLoading(out, 'Retraining yield, price & recommend models…');
    try {
      await api('/api/ml/train', { method: 'POST', body: JSON.stringify({}) });
      out.innerHTML = `<div class="alert alert--green">
        <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
        <div class="alert__body"><strong>All models retrained ✓</strong><p>Click "Check status" to see fresh metrics.</p></div></div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     FARM BOUNDARY PICKUP (from farm-boundary.html)
     When the user draws a polygon and clicks "Use in dashboard",
     we get a JSON blob in localStorage. Show a banner, pre-fill
     every `area_acres` input, and stash soil for the simulator.
     ========================================================== */
  const FARM_KEY = 'agrisim_farm';
  let savedFarm = null;
  try { savedFarm = JSON.parse(localStorage.getItem(FARM_KEY) || 'null'); } catch {}

  function mapBoundarySoilToSimulator(src) {
    // farm-boundary stores raw SoilGrids layers. The simulator wants
    // {ph, n_kg_per_acre, p_kg_per_acre, k_kg_per_acre}. Best-effort mapping.
    if (!src) return null;
    const ph = src.phh2o != null ? +src.phh2o / 10 : undefined; // cg→pH
    const n_raw = src.nitrogen;                                 // cg/kg
    const soc   = src.soc;                                      // dg/kg
    const fertility = soc != null ? Math.max(0.5, Math.min(1.5, soc / 200)) : 1;
    const out = {};
    if (ph != null && !isNaN(ph))      out.ph = +ph.toFixed(2);
    if (n_raw != null)                  out.n_kg_per_acre = +((n_raw / 100) * 4.047).toFixed(1);
    out.p_kg_per_acre = +(25 * fertility).toFixed(1);
    out.k_kg_per_acre = +(120 * fertility).toFixed(1);
    return out;
  }

  function renderFarmPickup() {
    const host = document.getElementById('farmPickup');
    if (!host) return;
    if (!savedFarm) { host.hidden = true; host.innerHTML = ''; return; }
    const acres = (savedFarm.acres || 0).toFixed(2);
    const ha = (savedFarm.hectares || 0).toFixed(2);
    const loc = savedFarm.centroid
      ? `${savedFarm.centroid[1].toFixed(3)}°, ${savedFarm.centroid[0].toFixed(3)}°`
      : 'unknown';
    host.hidden = false;
    host.innerHTML = `
      <div class="farm-pickup__ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4"/><path d="M12 11v10"/></svg>
      </div>
      <div class="farm-pickup__body">
        <strong>Using your drawn farm · ${acres} acres (${ha} ha)</strong>
        <span>Centroid ${loc} · area is pre-filled across every tool${savedFarm.soil ? '. Soil from SoilGrids at the centroid will be used during simulation.' : '.'}</span>
      </div>
      <div class="farm-pickup__actions">
        <a href="farm-boundary.html" class="btn btn-ghost" style="padding:8px 14px;font-size:.85rem;">Edit</a>
        <button id="farmPickupClear" class="btn btn-ghost" style="padding:8px 14px;font-size:.85rem;">Clear</button>
      </div>`;
    document.getElementById('farmPickupClear').addEventListener('click', () => {
      try { localStorage.removeItem(FARM_KEY); } catch {}
      savedFarm = null;
      renderFarmPickup();
    });
  }

  function applyFarmToForms() {
    if (!savedFarm || !savedFarm.acres) return;
    const area = +savedFarm.acres.toFixed(2);
    $$('input[name="area_acres"]').forEach(el => { el.value = area; });
  }

  renderFarmPickup();
  applyFarmToForms();

  /* ==========================================================
     WEATHER OVERRIDE — hooks into the Simulate tool.
     1. User toggles the checkbox → rainfall/temp inputs win.
     2. "Fetch live weather" fills them from the API so they
        can inspect and tweak before simulating.
     3. Submit handler (below) short-circuits the API call
        when override is active.
     ========================================================== */
  const simForm = $('[data-form="simulate"]');
  if (simForm) {
    const fetchBtn = simForm.querySelector('[data-weather-fetch]');
    fetchBtn?.addEventListener('click', async () => {
      const region = simForm.region_id.value;
      const season = simForm.season.value;
      const original = fetchBtn.textContent;
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Fetching…';
      try {
        const w = await api(`/api/weather/${region}?season=${season}`);
        if (w && w.rainfall_mm != null) simForm.rainfall_mm.value = Math.round(+w.rainfall_mm);
        if (w && w.avg_temp_c != null)  simForm.avg_temp_c.value  = (+w.avg_temp_c).toFixed(1);
        simForm.weather_override_on.checked = true;
      } catch (err) {
        alert('Live weather unavailable: ' + err.message);
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = original;
      }
    });
  }

  // Patch the simulate handler post-hoc: intercept the fetch via a shim.
  // Simpler path: expose the override via a getter the handler reads.
  window.__agrisimWeatherOverride = () => {
    if (!simForm) return null;
    const on = simForm.weather_override_on && simForm.weather_override_on.checked;
    if (!on) return null;
    const rain = parseFloat(simForm.rainfall_mm.value);
    const temp = parseFloat(simForm.avg_temp_c.value);
    if (!isFinite(rain) && !isFinite(temp)) return null;
    const out = {};
    if (isFinite(rain)) out.rainfall_mm = rain;
    if (isFinite(temp)) out.avg_temp_c  = temp;
    return out;
  };

  window.__agrisimFarmSoil = () => {
    if (!savedFarm || !savedFarm.soil) return null;
    return mapBoundarySoilToSimulator(savedFarm.soil);
  };

})();
