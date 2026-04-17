/* =========================================================
   AgriSim — Live on-page crop recommender
   Uses AgriSimStateData to produce a plausible ranked list
   of 3 crops for the chosen state / season / area / budget.
   Pure client-side — no backend required for the landing page.
   ========================================================= */

(() => {
  const DATA = window.AgriSimStateData;
  const form = document.getElementById('liveDemoForm');
  if (!DATA || !form) return;

  const stateSel  = document.getElementById('ldState');
  const seasonSel = document.getElementById('ldSeason');
  const areaInp   = document.getElementById('ldArea');
  const budgetInp = document.getElementById('ldBudget');
  const runBtn    = document.getElementById('ldRun');
  const resultEl  = document.getElementById('ldResult');

  // Rough season map for each crop (used to nudge score)
  const CROP_SEASON = {
    Rice: 'kharif', Maize: 'kharif', Cotton: 'kharif', Soybean: 'kharif',
    Groundnut: 'kharif', Bajra: 'kharif', Jute: 'kharif', Sugarcane: 'any',
    Ragi: 'kharif', Pulses: 'kharif', Oilseeds: 'kharif', Pineapple: 'any',
    Banana: 'any', Coconut: 'any', Cashew: 'any', Rubber: 'any', Spices: 'any',
    Coffee: 'any', Tea: 'any', Cardamom: 'any', Turmeric: 'kharif',
    Ginger: 'kharif', Millets: 'kharif', Bamboo: 'any', Areca: 'any',
    Fisheries: 'any',
    Wheat: 'rabi', Mustard: 'rabi', Gram: 'rabi', Barley: 'rabi',
    Basmati: 'kharif', Apple: 'any', Apricot: 'any', Saffron: 'rabi',
    Potato: 'rabi', Vegetables: 'any'
  };

  // Populate states
  const stateNames = Object.keys(DATA.all).sort();
  stateSel.innerHTML = stateNames.map(n =>
    `<option value="${n}" ${n === 'Maharashtra' ? 'selected' : ''}>${n}</option>`
  ).join('');

  function estimateForCrop(crop, stateData, season, area, budget) {
    const seasonFit = (() => {
      const s = CROP_SEASON[crop.crop];
      if (!s || s === 'any') return 1;
      return s === season ? 1 : 0.55;
    })();

    const score = crop.score * seasonFit;
    // Yield kg/acre — very rough category-based
    const baseYield = /Rice|Wheat|Maize|Bajra|Ragi|Barley|Millets/.test(crop.crop) ? 1800
                   : /Sugarcane/.test(crop.crop) ? 45000
                   : /Cotton/.test(crop.crop) ? 450
                   : /Soybean|Groundnut|Mustard|Gram|Pulses|Oilseeds/.test(crop.crop) ? 900
                   : /Banana|Potato|Vegetables/.test(crop.crop) ? 14000
                   : /Coconut|Cashew|Apple|Apricot|Pineapple/.test(crop.crop) ? 6000
                   : /Tea|Coffee|Cardamom|Turmeric|Ginger|Spices|Saffron|Rubber/.test(crop.crop) ? 1200
                   : 1500;
    const yieldKgAcre = baseYield * (0.7 + 0.6 * score);
    const revenuePerAcre = yieldKgAcre * crop.mandi;
    const costPerAcre = Math.max(budget, 5000) * (0.9 + (1 - score) * 0.3);
    const profitPerAcre = revenuePerAcre - costPerAcre;
    const profitTotal = profitPerAcre * area;
    const risk = Math.round((1 - score) * 70 + (seasonFit < 1 ? 15 : 0));
    return {
      crop: crop.crop,
      mandi: crop.mandi,
      score,
      yieldKgAcre: Math.round(yieldKgAcre),
      revenuePerAcre: Math.round(revenuePerAcre),
      costPerAcre: Math.round(costPerAcre),
      profitPerAcre: Math.round(profitPerAcre),
      profitTotal: Math.round(profitTotal),
      roi: costPerAcre > 0 ? Math.round((profitPerAcre / costPerAcre) * 100) : 0,
      risk: Math.max(8, Math.min(92, risk))
    };
  }

  function run() {
    const stateName = stateSel.value;
    const season    = seasonSel.value;
    const area      = Math.max(0.5, parseFloat(areaInp.value) || 1);
    const budget    = Math.max(1000, parseFloat(budgetInp.value) || 15000);
    const d = DATA.get(stateName);

    if (!d) {
      resultEl.innerHTML = '<div class="livedemo__empty">No data for that state.</div>';
      return;
    }

    const ranked = d.topCrops
      .map(c => estimateForCrop(c, d, season, area, budget))
      .sort((a, b) => b.profitTotal - a.profitTotal);

    const summary = `
      <div class="livedemo__summary">
        <div><span>State</span><b>${stateName}</b></div>
        <div><span>Season</span><b>${season === 'kharif' ? 'Kharif' : 'Rabi'}</b></div>
        <div><span>Area</span><b>${area} acres</b></div>
        <div><span>Rainfall</span><b>${d.rainfall} mm</b></div>
        <div><span>Soil N</span><b>${d.soilN} kg/ha</b></div>
      </div>`;

    const cards = ranked.map((r, i) => `
      <article class="livedemo__card livedemo__card--${i+1}">
        <div class="livedemo__rank">#${i+1}</div>
        <h4>${r.crop}</h4>
        <div class="livedemo__kv">
          <div><span>Expected profit</span><b>₹${r.profitTotal.toLocaleString('en-IN')}</b><em>over ${area} acres</em></div>
          <div><span>ROI</span><b>${r.roi}%</b></div>
          <div><span>Yield</span><b>${r.yieldKgAcre.toLocaleString('en-IN')} <small>kg/acre</small></b></div>
          <div><span>Mandi</span><b>₹${r.mandi.toLocaleString('en-IN')}</b></div>
        </div>
        <div class="livedemo__bars">
          <div class="livedemo__bar">
            <span>Fit ${Math.round(r.score*100)}</span>
            <i style="width:${Math.round(r.score*100)}%; background:linear-gradient(90deg,var(--brand),var(--accent));"></i>
          </div>
          <div class="livedemo__bar">
            <span>Risk ${r.risk}</span>
            <i style="width:${r.risk}%; background:linear-gradient(90deg,#8fb04a,#d45c4a);"></i>
          </div>
        </div>
      </article>`).join('');

    resultEl.innerHTML = summary + '<div class="livedemo__cards">' + cards + '</div>';
    // If a language other than English is active, retranslate the new DOM
    if (window.AgriSimI18n && window.AgriSimI18n.getLanguage() !== 'en') {
      window.AgriSimI18n.retranslate();
    }
  }

  runBtn.addEventListener('click', run);
  [stateSel, seasonSel].forEach(el => el.addEventListener('change', run));
  // First paint after a tick so state-data.js has loaded
  setTimeout(run, 50);
})();
