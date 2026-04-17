/* =========================================================
   AgriSim — Indian state agricultural data (approximations)
   Shared between scene3d.js and dashboard tooltips.
   Values are representative, intended for visualisation.
   ========================================================= */
(function () {
  const D = (rain, soilN, profit, crops) => ({ rainfall: rain, soilN, avgProfit: profit, topCrops: crops });
  const C = (crop, score, mandi) => ({ crop, score, mandi });

  // Data keyed by common GeoJSON state-name variants (we normalise below).
  const RAW = {
    'Andhra Pradesh':   D(912, 240, 58000, [C('Rice',0.92,2100),  C('Cotton',0.78,7200),  C('Groundnut',0.71,5800)]),
    'Arunachal Pradesh':D(2782,210, 32000, [C('Rice',0.74,2000),  C('Maize',0.66,1900),   C('Ginger',0.62,5200)]),
    'Assam':            D(2818,225, 42000, [C('Rice',0.88,2050),  C('Tea',0.82,180),      C('Jute',0.70,4400)]),
    'Bihar':            D(1205,195, 46000, [C('Rice',0.82,2100),  C('Wheat',0.79,2200),   C('Maize',0.70,1950)]),
    'Chhattisgarh':     D(1338,210, 44000, [C('Rice',0.85,2080),  C('Soybean',0.65,4200), C('Maize',0.62,1900)]),
    'Goa':              D(2913,205, 52000, [C('Coconut',0.80,35), C('Cashew',0.78,1400),  C('Rice',0.66,2100)]),
    'Gujarat':          D(847, 215, 62000, [C('Cotton',0.88,7300),C('Groundnut',0.82,5900),C('Wheat',0.66,2250)]),
    'Haryana':          D(617, 250, 68000, [C('Wheat',0.93,2250), C('Rice',0.80,2150),    C('Mustard',0.72,5400)]),
    'Himachal Pradesh': D(1251,230, 55000, [C('Apple',0.90,55),   C('Wheat',0.70,2200),   C('Maize',0.65,1900)]),
    'Jammu and Kashmir':D(1011,240, 54000, [C('Apple',0.92,60),   C('Rice',0.70,2100),    C('Saffron',0.85,300000)]),
    'Jharkhand':        D(1322,200, 38000, [C('Rice',0.78,2050),  C('Maize',0.64,1900),   C('Pulses',0.60,5500)]),
    'Karnataka':        D(1139,225, 60000, [C('Ragi',0.84,3400),  C('Sugarcane',0.80,310),C('Coffee',0.76,220)]),
    'Kerala':           D(3055,200, 56000, [C('Coconut',0.88,38), C('Rubber',0.82,170),   C('Spices',0.85,450)]),
    'Madhya Pradesh':   D(1017,220, 58000, [C('Soybean',0.90,4400),C('Wheat',0.84,2250),  C('Gram',0.72,5200)]),
    'Maharashtra':      D(1181,215, 63000, [C('Sugarcane',0.88,315),C('Cotton',0.80,7200),C('Soybean',0.72,4300)]),
    'Manipur':          D(1467,210, 34000, [C('Rice',0.80,2050),  C('Maize',0.62,1900),   C('Pineapple',0.70,25)]),
    'Meghalaya':        D(2818,215, 36000, [C('Rice',0.76,2050),  C('Turmeric',0.82,9200),C('Ginger',0.74,5500)]),
    'Mizoram':          D(2411,200, 33000, [C('Rice',0.72,2050),  C('Ginger',0.75,5400),  C('Bamboo',0.68,18)]),
    'Nagaland':         D(1881,205, 34000, [C('Rice',0.78,2050),  C('Maize',0.64,1900),   C('Millets',0.60,3200)]),
    'Odisha':           D(1451,210, 44000, [C('Rice',0.87,2080),  C('Pulses',0.68,5600),  C('Oilseeds',0.66,5200)]),
    'Punjab':           D(649, 260, 72000, [C('Wheat',0.95,2250), C('Rice',0.90,2150),    C('Basmati',0.85,3800)]),
    'Rajasthan':        D(574, 180, 52000, [C('Bajra',0.82,2300), C('Mustard',0.80,5400), C('Wheat',0.66,2200)]),
    'Sikkim':           D(2739,225, 48000, [C('Cardamom',0.90,1200),C('Ginger',0.78,5400),C('Maize',0.60,1900)]),
    'Tamil Nadu':       D(998, 220, 58000, [C('Rice',0.86,2100),  C('Sugarcane',0.78,310),C('Banana',0.82,25)]),
    'Telangana':        D(906, 225, 56000, [C('Cotton',0.86,7250),C('Rice',0.80,2100),    C('Maize',0.70,1950)]),
    'Tripura':          D(2426,210, 38000, [C('Rice',0.80,2050),  C('Jute',0.68,4400),    C('Tea',0.72,175)]),
    'Uttar Pradesh':    D(979, 230, 54000, [C('Wheat',0.89,2250), C('Sugarcane',0.86,315),C('Rice',0.78,2100)]),
    'Uttarakhand':      D(1548,225, 46000, [C('Rice',0.74,2100),  C('Wheat',0.76,2200),   C('Basmati',0.78,3700)]),
    'West Bengal':      D(1771,215, 52000, [C('Rice',0.90,2100),  C('Jute',0.82,4500),    C('Potato',0.76,16)]),
    // UTs
    'Delhi':            D(774, 230, 42000, [C('Wheat',0.72,2250), C('Mustard',0.64,5400), C('Vegetables',0.70,15)]),
    'Chandigarh':       D(1110,240, 48000, [C('Wheat',0.80,2250), C('Rice',0.70,2150),    C('Maize',0.60,1950)]),
    'Puducherry':       D(1355,210, 50000, [C('Rice',0.78,2100),  C('Sugarcane',0.72,310),C('Pulses',0.64,5500)]),
    'Andaman and Nicobar':D(3181,200,36000,[C('Coconut',0.84,36), C('Rice',0.70,2100),    C('Areca',0.74,280)]),
    'Dadra and Nagar Haveli and Daman and Diu': D(2096,205,40000,[C('Rice',0.72,2100),C('Ragi',0.62,3300),C('Coconut',0.68,35)]),
    'Lakshadweep':      D(1640,195, 34000, [C('Coconut',0.90,38), C('Fisheries',0.80,180),C('Pulses',0.50,5500)]),
    'Ladakh':           D(102, 160, 28000, [C('Barley',0.72,2300),C('Apricot',0.70,120),  C('Apple',0.65,55)])
  };

  // Name normalisation for different GeoJSON sources
  const ALIASES = {
    'NCT of Delhi': 'Delhi',
    'Nct Of Delhi': 'Delhi',
    'Jammu & Kashmir': 'Jammu and Kashmir',
    'Jammu And Kashmir': 'Jammu and Kashmir',
    'Andaman & Nicobar Island': 'Andaman and Nicobar',
    'Andaman & Nicobar Islands': 'Andaman and Nicobar',
    'Andaman And Nicobar Islands': 'Andaman and Nicobar',
    'Dadra and Nagar Haveli': 'Dadra and Nagar Haveli and Daman and Diu',
    'Daman and Diu': 'Dadra and Nagar Haveli and Daman and Diu',
    'Dadra And Nagar Haveli And Daman And Diu': 'Dadra and Nagar Haveli and Daman and Diu',
    'Telengana': 'Telangana',
    'Orissa': 'Odisha',
    'Pondicherry': 'Puducherry'
  };

  function normalise(name) {
    if (!name) return name;
    if (RAW[name]) return name;
    if (ALIASES[name]) return ALIASES[name];
    // Title-case retry
    const tc = name.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
    if (RAW[tc]) return tc;
    if (ALIASES[tc]) return ALIASES[tc];
    return name;
  }

  function get(name) {
    const n = normalise(name);
    return RAW[n] || null;
  }

  // Collect all unique crops
  const CROPS = new Set();
  Object.values(RAW).forEach(s => s.topCrops.forEach(c => CROPS.add(c.crop)));

  window.AgriSimStateData = {
    get,
    normalise,
    all: RAW,
    crops: Array.from(CROPS).sort(),
    // Suitability of a state for a given crop (0..1). If crop not in top, returns 0.
    suitability(stateName, crop) {
      const d = get(stateName);
      if (!d) return 0;
      const found = d.topCrops.find(c => c.crop === crop);
      return found ? found.score : 0;
    },
    // Ranges for heatmap normalisation
    ranges: (function () {
      const r = { rainfall: [Infinity, -Infinity], soilN: [Infinity, -Infinity], avgProfit: [Infinity, -Infinity] };
      Object.values(RAW).forEach(s => {
        r.rainfall[0] = Math.min(r.rainfall[0], s.rainfall);
        r.rainfall[1] = Math.max(r.rainfall[1], s.rainfall);
        r.soilN[0]    = Math.min(r.soilN[0], s.soilN);
        r.soilN[1]    = Math.max(r.soilN[1], s.soilN);
        r.avgProfit[0]= Math.min(r.avgProfit[0], s.avgProfit);
        r.avgProfit[1]= Math.max(r.avgProfit[1], s.avgProfit);
      });
      return r;
    })()
  };
})();
