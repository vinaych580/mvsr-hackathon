/* =========================================================
   AgriSim — Offline simulator
   A stripped-down JavaScript port of engine/simulator.py so the
   dashboard's "Simulate" tool keeps working when the FastAPI
   backend is unreachable (demo mode, poor connectivity, etc.).

   Exposes window.AgriSimOffline with:
     - simulate(body)  → same response shape as /api/simulate
     - recommend(body) → simple top-3 using crop params
   Numbers are close-enough to the server model — not identical.
   ========================================================= */

(() => {
  // Representative per-acre baseline yields (kg/acre) and category info.
  // Tuned to roughly match dataset/crop_parameters.csv so the user gets a
  // believable answer when offline. The server model is still authoritative.
  const CROPS = {
    rice:      { name: 'Rice',      season: 'kharif', base_yield: 1800, water_mm: 1200, temp_min: 20, temp_max: 35, n: 65, p: 25, k: 45, base_cost: 13500 },
    wheat:     { name: 'Wheat',     season: 'rabi',   base_yield: 1600, water_mm:  450, temp_min: 10, temp_max: 25, n: 55, p: 22, k: 35, base_cost: 12000 },
    maize:     { name: 'Maize',     season: 'kharif', base_yield: 2400, water_mm:  600, temp_min: 18, temp_max: 33, n: 60, p: 20, k: 40, base_cost: 11000 },
    cotton:    { name: 'Cotton',    season: 'kharif', base_yield:  450, water_mm:  700, temp_min: 21, temp_max: 35, n: 70, p: 25, k: 45, base_cost: 16000 },
    sugarcane: { name: 'Sugarcane', season: 'kharif', base_yield: 45000, water_mm: 1800, temp_min: 20, temp_max: 35, n: 85, p: 30, k: 60, base_cost: 22000 },
    soybean:   { name: 'Soybean',   season: 'kharif', base_yield:  900, water_mm:  550, temp_min: 18, temp_max: 32, n: 30, p: 25, k: 30, base_cost: 10000 },
    groundnut: { name: 'Groundnut', season: 'kharif', base_yield: 1000, water_mm:  600, temp_min: 20, temp_max: 32, n: 20, p: 25, k: 40, base_cost: 12000 },
    pulses:    { name: 'Pulses',    season: 'kharif', base_yield:  700, water_mm:  450, temp_min: 18, temp_max: 32, n: 18, p: 22, k: 30, base_cost:  9500 },
    mustard:   { name: 'Mustard',   season: 'rabi',   base_yield:  900, water_mm:  350, temp_min: 10, temp_max: 25, n: 35, p: 22, k: 30, base_cost: 10500 },
    bajra:     { name: 'Bajra',     season: 'kharif', base_yield: 1100, water_mm:  400, temp_min: 22, temp_max: 36, n: 30, p: 18, k: 25, base_cost:  8500 },
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function fitScore(crop, ctx) {
    const { rainfall_mm = 800, avg_temp_c = 27, soil_ph = 6.8,
            n_kg_per_acre = 40, irrigation_level = 0.5 } = ctx;
    // Water fit — rainfall + irrigation should match crop water need.
    const availableWater = rainfall_mm + irrigation_level * 400;
    const waterRatio = availableWater / crop.water_mm;
    const waterFit = 1 - Math.min(1, Math.abs(1 - waterRatio) * 0.9);
    // Temp fit — inside [min, max] gets full marks, outside degrades.
    const tempFit = avg_temp_c < crop.temp_min ? 1 - (crop.temp_min - avg_temp_c) / 15
                   : avg_temp_c > crop.temp_max ? 1 - (avg_temp_c - crop.temp_max) / 15
                   : 1;
    // pH fit — staple crops are happy between 6 and 7.5.
    const phFit = 1 - Math.min(1, Math.abs(6.8 - soil_ph) / 2);
    // Nitrogen fit — ratio of available to required.
    const nFit = clamp(n_kg_per_acre / crop.n, 0.5, 1.1);
    return clamp(0.3 * waterFit + 0.25 * tempFit + 0.2 * phFit + 0.25 * nFit, 0.15, 1.0);
  }

  function simulate(body) {
    const crop = CROPS[body.crop_id];
    if (!crop) throw new Error(`offline simulator: unknown crop '${body.crop_id}'`);

    const soil = body.soil || {};
    const weather = body.weather || {};
    const ctx = {
      rainfall_mm: +weather.rainfall_mm || 800,
      avg_temp_c: +weather.avg_temp_c || 27,
      soil_ph: +soil.ph || 6.8,
      n_kg_per_acre: +soil.n_kg_per_acre || 40,
      irrigation_level: +body.irrigation_level || 0.5,
    };
    const score = fitScore(crop, ctx);

    const area = +body.area_acres || 1;
    const mandi = +body.mandi_price_per_kg || 25;

    const yieldKgAcre = crop.base_yield * (0.55 + 0.55 * score);
    const totalYield = yieldKgAcre * area;

    const plan = body.input_plan || {};
    const costs = {
      seed: +plan.seed_cost_per_acre || 2500,
      fertilizer: +plan.fertilizer_cost_per_acre || 4000,
      labour: +plan.labour_cost_per_acre || 5000,
      irrigation: +plan.irrigation_cost_per_acre || 1000,
      pesticide: +plan.pesticide_cost_per_acre || 600,
      machinery: +plan.machinery_cost_per_acre || 400,
    };
    const costPerAcre = Object.values(costs).reduce((a, b) => a + b, 0);
    const totalCost = costPerAcre * area;
    const revenue = totalYield * mandi;
    const profit = revenue - totalCost;
    const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
    const breakEven = totalYield > 0 ? totalCost / totalYield : 0;

    // Risk on a 0-100 scale to match the online /api/simulate response shape.
    const riskScore = clamp((1 - score) * 100 + (ctx.irrigation_level < 0.3 ? 10 : 0), 5, 95);

    // Match the server's nutrient_analysis shape so the dashboard renderer
    // (which reads n_available / n_required / n_deficit + p_* + k_*) works offline too.
    const nAvail = ctx.n_kg_per_acre;
    const pAvail = +soil.p_kg_per_acre || 20;
    const kAvail = +soil.k_kg_per_acre || 35;
    const nutrient = {
      n_available: +nAvail.toFixed(1),
      p_available: +pAvail.toFixed(1),
      k_available: +kAvail.toFixed(1),
      n_required: crop.n,
      p_required: crop.p,
      k_required: crop.k,
      n_deficit: +Math.max(0, crop.n - nAvail).toFixed(1),
      p_deficit: +Math.max(0, crop.p - pAvail).toFixed(1),
      k_deficit: +Math.max(0, crop.k - kAvail).toFixed(1),
    };

    // Sensitivity matrix (5×5) across ±20% yield and price. Keys mirror
    // engine.simulator's projected_profit / projected_roi_pct shape.
    const steps = [-20, -10, 0, 10, 20];
    const sensitivity = [];
    for (const yPct of steps) {
      for (const pPct of steps) {
        const adjYield = totalYield * (1 + yPct / 100);
        const adjPrice = mandi * (1 + pPct / 100);
        const projProfit = adjYield * adjPrice - totalCost;
        const projRoi = totalCost > 0 ? (projProfit / totalCost) * 100 : 0;
        sensitivity.push({
          yield_change_pct: yPct,
          price_change_pct: pPct,
          projected_profit: Math.round(projProfit),
          projected_roi_pct: +projRoi.toFixed(1),
        });
      }
    }

    return {
      _offline: true,
      crop_id: body.crop_id,
      crop_name: crop.name,
      area_acres: area,
      yield_kg_per_acre: Math.round(yieldKgAcre),
      total_yield_kg: Math.round(totalYield),
      cost_breakdown_per_acre: {
        seed: costs.seed, fertilizer: costs.fertilizer, labour: costs.labour,
        irrigation: costs.irrigation, pesticide: costs.pesticide, machinery: costs.machinery,
      },
      total_cost_per_acre: Math.round(costPerAcre),
      total_cost: Math.round(totalCost),
      revenue: Math.round(revenue),
      profit: Math.round(profit),
      roi_percent: +roi.toFixed(1),
      break_even_price_per_kg: +breakEven.toFixed(2),
      risk_score: +riskScore.toFixed(1),
      risk_subscores: {
        weather: +(1 - score).toFixed(2),
        price: 0.3,
        nutrient: +clamp(nutrient.n_deficit / crop.n, 0, 1).toFixed(2),
      },
      water_efficiency: {
        // Dashboard reads .water_per_kg_yield_liters and .irrigation_coverage_percent.
        // 1 mm of water over 1 acre ≈ 4047 L, so convert crop water need → litres per kg yield.
        water_per_kg_yield_liters: Math.round((crop.water_mm * 4047) / Math.max(1, yieldKgAcre)),
        irrigation_coverage_percent: Math.round(clamp(ctx.irrigation_level * 100, 0, 100)),
      },
      nutrient_analysis: nutrient,
      sensitivity,
      assumptions: [
        'Running in OFFLINE mode — numbers from on-device heuristic.',
        'Switch to the online backend (refresh while connected) for the ML-backed simulation.',
      ],
    };
  }

  function recommend(body) {
    const area = +body.area_acres || 1;
    const budget = +body.budget_per_acre || 15000;
    const season = (body.season || 'kharif').toLowerCase();

    const candidates = Object.entries(CROPS)
      .filter(([, c]) => c.season === season || c.season === 'any')
      .map(([id, crop]) => {
        // Without region/soil context, use season-average assumptions.
        const score = fitScore(crop, {});
        const expectedProfit = crop.base_yield * 0.8 * 25 - budget;
        return {
          crop_id: id,
          crop_name: crop.name,
          score: +score.toFixed(2),
          fit_score: +score.toFixed(2),
          expected_yield_kg_per_acre: Math.round(crop.base_yield * score),
          expected_profit_per_acre: Math.round(expectedProfit),
          expected_profit_total: Math.round(expectedProfit * area),
          confidence: +clamp(score + 0.1, 0, 1).toFixed(2),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return candidates;
  }

  window.AgriSimOffline = { simulate, recommend };
})();
