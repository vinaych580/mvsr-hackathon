// app.js - AgriSim Earthy Claymorphism Architecture

// --- Configuration & i18n ---
const LANG = 'en';
const translations = {
    'en': {
        'nav_home': 'Home',
        'nav_setup': 'Workspace',
        'nav_strategy': 'Strategy',
        'prop_title': 'Predict. Plan.',
        'prop_title_italic': 'Prosper.',
        'prop_desc': 'Simulate and compare crop strategies before sowing. The field journal for the digital farmer.',
        'btn_start': 'Start Setup',
        'crop_rice': 'Rice', 'crop_wheat':'Wheat', 'crop_maize':'Maize', 'crop_sugarcane':'Sugarcane', 
        'crop_cotton':'Cotton', 'crop_pulses':'Pulses', 'crop_groundnut':'Groundnut', 'crop_soybean':'Soybean',
        'setup_region': 'Pick Region', 'setup_area': 'Area (Acres)', 'setup_irrigation': 'Irrigation Control',
        'setup_season': 'Season', 'setup_save': 'Save & Plan Crop',
        'str_select': 'Select Crop', 'str_budget': 'Budget (per Acre)', 'str_variety': 'Seed Variety',
        'str_run': 'Run Simulation',
        'res_yield': 'Yield', 'res_profit': 'Profit', 'res_cost': 'Cost', 'res_roi': 'ROI',
        'res_compare_btn': 'Save & Compare',
        'cmp_empty': "Your journal is empty. Plan some strategies to measure them here.",
        'cmp_build_new': 'Plan new crop'
    }
    // Future expansion: 'te': { 'nav_home': 'నకిలీ' ... } //
};
function t(key) {
    if(!translations[LANG]) return key;
    return translations[LANG][key] || key;
}

// Crop Emojis lookup mapping to specific UI presentation
const cropDecorators = {
    'rice': '🌾', 'wheat': '🍞', 'maize': '🌽', 'sugarcane': '🎋',
    'cotton': '☁️', 'pulses': '🫘', 'groundnut': '🥜', 'soybean': '🌱'
};

// --- API Client ---
class ApiClient {
    constructor(baseUrl = 'http://localhost:8000/api') {
        this.baseUrl = baseUrl;
    }

    async get(endpoint) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (e) {
            console.error(`Error GET ${endpoint}:`, e);
            throw e;
        }
    }

    async post(endpoint, data) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (e) {
            console.error(`Error POST ${endpoint}:`, e);
            throw e;
        }
    }
}

// --- App State ---
class AppState {
    constructor() {
        this.currentRegion = null;
        this.currentSeason = 'kharif';
        this.weather = null;
        this.soil = null;
        this.crops = [];
        this.recommendedCrops = [];
        this.selectedCropId = null;
        this.simulationConfig = {
            area_acres: 3, // Persona Default
            irrigation_level: 0.5,
            seed_variety: 'standard',
            budget_per_acre: 15000,
            sowing_date: new Date().toISOString().split('T')[0]
        };
        this.lastSimulationResult = null;
        this.savedStrategies = [];
    }
}

const api = new ApiClient();
const state = new AppState();


// --- Chart.js Global Restyle ---
Chart.defaults.font.family = "'Quicksand', sans-serif";
Chart.defaults.color = '#3B2E25';
const CH_COLORS = ['#5C7A4A', '#E0A458', '#C97B5C', '#A9C4C2', '#6B4F3A', '#A4453A'];


// --- Utility ---
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function renderLoadingState() {
    return `
        <div class="flex flex-col items-center justify-center min-h-[40vh] gap-6">
            <div class="w-16 h-16 rounded-full clay-badge flex items-center justify-center animate-seed bg-clay-surface shadow-clay">
                <i data-lucide="sprout" class="w-8 h-8 text-moss"></i>
            </div>
            <p class="font-heading text-soil animate-pulse text-lg tracking-wider">Evaluating Engine...</p>
        </div>
    `;
}

function renderErrorState(msg) {
    return `
        <div class="max-w-2xl mx-auto my-20 p-6 rounded-clay bg-[#fceceb] border border-risk-rust/20 text-risk-rust flex items-start gap-4">
            <i data-lucide="alert-circle" class="mt-1"></i>
            <div>
                <h3 class="font-heading font-bold text-lg">Hitch in the system</h3>
                <p class="text-sm opacity-80 mt-1">${msg}</p>
            </div>
        </div>
    `;
}


// --- Routing ---
const routes = {
    '/': renderLanding,
    '/setup': renderFarmSetup,
    '/strategy': renderStrategyBuilder,
    '/results': renderSimulationResults,
    '/compare': renderCompare
};

function router() {
    let path = window.location.hash.slice(1) || '/';
    const appDiv = document.getElementById('app-content');
    
    // Page Transitions (200ms crossfade per instructions)
    appDiv.style.opacity = '0';
    
    // Update nav styling organically
    document.querySelectorAll('#main-nav a').forEach(a => {
        if(a.getAttribute('href') === '#' + path) {
            a.className = "text-moss font-bold border-b-2 border-moss pb-1 transition-all";
        } else {
            a.className = "text-bark hover:text-moss transition-all";
        }
    });

    setTimeout(async () => {
        appDiv.innerHTML = renderLoadingState();
        appDiv.style.opacity = '1';
        
        try {
            if (routes[path]) {
                await routes[path](appDiv);
                lucide.createIcons(); // Refresh icons
            } else {
                appDiv.innerHTML = renderErrorState('404 - Screen Not Found');
            }
        } catch(e) {
            console.error("Rendering error:", e);
            appDiv.innerHTML = renderErrorState(e.message);
        }
    }, 200);
}

window.addEventListener('hashchange', router);
window.addEventListener('load', router);



// ==========================================
// 1. Landing (#/)
// ==========================================
async function renderLanding(container) {
    try {
        if (state.crops.length === 0) {
            state.crops = await api.get('/crops');
        }
        
        const cropsHtml = state.crops.map(c => `
            <div class="clay-card interactive flex flex-col items-center justify-center p-6 text-center cursor-pointer min-h-[140px]" onclick="window.location.hash='/setup'">
                <div class="w-14 h-14 rounded-full crop-badge flex items-center justify-center text-2xl mb-3">
                    ${cropDecorators[c.crop_id] || '🌱'}
                </div>
                <h3 class="font-heading font-bold text-soil text-lg">${t('crop_'+c.crop_id)}</h3>
            </div>
        `).join('');

        container.innerHTML = `
            <main class="relative px-6 py-20 lg:py-32 max-w-7xl mx-auto w-full flex flex-col lg:flex-row items-center gap-16 overflow-hidden min-h-[80vh]">
                
                <!-- Ambient Blob Background -->
                <div class="blob-bg bg-moss/20 w-96 h-96 top-0 left-[-10%] sm:left-10"></div>
                <div class="blob-bg bg-saffron/20 w-[30rem] h-[30rem] bottom-10 right-[-10%] sm:right-10"></div>

                <div class="flex-1 z-10">
                    <h1 class="text-6xl md:text-8xl font-heading font-black text-soil mb-6 leading-[1.05] tracking-tight text-balance">
                        ${t('prop_title')}<br/>
                        <span class="text-moss italic">${t('prop_title_italic')}</span>
                    </h1>
                    <p class="text-xl md:text-2xl text-bark/80 max-w-lg mb-10 leading-relaxed font-medium">
                        ${t('prop_desc')}
                    </p>
                    <button onclick="window.location.hash='/setup'" class="clay-btn px-8 py-4 text-lg">
                        ${t('btn_start')} <i data-lucide="arrow-right" class="w-5 h-5"></i>
                    </button>
                    
                    <!-- One Ambient Micro-Animation Leaf -->
                    <div class="absolute left-[35%] top-[10%] opacity-20 pointer-events-none animate-[pulse-seed_4s_infinite_ease-in-out]">
                        <i data-lucide="leaf" class="w-20 h-20 text-moss transform rotate-45"></i>
                    </div>
                </div>

                <div class="flex-1 w-full max-w-lg lg:max-w-none z-10">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        ${cropsHtml}
                    </div>
                </div>
            </main>
        `;
    } catch (e) {
        container.innerHTML = renderErrorState('Failed to load crop assets from the Engine. Is the backend running?');
    }
}


// ==========================================
// 2. Farm Setup (#/setup)
// ==========================================
async function renderFarmSetup(container) {
    let regions = [];
    try {
        regions = await api.get('/regions');
    } catch(e) {
        console.warn("Could not fetch regions", e);
    }

    const regionOptions = regions.map(r => `<option value="${r.id}" ${state.currentRegion===r.id?'selected':''}>${r.name}</option>`).join('');

    const recommendationChips = state.recommendedCrops.map(rec => `
        <button onclick="window.state.selectedCropId='${rec.crop_id}'; window.location.hash='/strategy'" class="clay-card interactive inline-flex items-center gap-2 px-4 py-2 border-none">
            <span class="text-lg">${cropDecorators[rec.crop_id]||'🌾'}</span>
            <span class="font-heading font-bold text-sm text-soil">${rec.crop_id}</span>
        </button>
    `).join('');

    container.innerHTML = `
        <main class="relative px-6 py-12 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-start mt-8">
            
            <!-- Left Side Inputs -->
            <div class="lg:col-span-5 space-y-8">
                <div>
                    <h2 class="text-4xl font-heading font-bold text-soil mb-2">Farm Topography</h2>
                    <p class="text-bark/80 font-medium">Define your environment baseline to align the simulator.</p>
                </div>

                <div class="space-y-6">
                    <div>
                        <label class="block font-heading font-bold text-soil mb-3">${t('setup_region')}</label>
                        <select id="region-select" class="clay-input-well focus:ring-0">
                            <option value="" disabled ${!state.currentRegion?'selected':''}>Select Agricultural Zone</option>
                            ${regionOptions}
                        </select>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block font-heading font-bold text-soil mb-3">${t('setup_area')}</label>
                            <input type="number" id="area-input" value="${state.simulationConfig.area_acres}" class="clay-input-well text-center tabular-nums" />
                        </div>
                        <div>
                            <label class="block font-heading font-bold text-soil mb-3">${t('setup_season')}</label>
                            <select id="season-select" class="clay-input-well focus:ring-0">
                                <option value="kharif" ${state.currentSeason==='kharif'?'selected':''}>Kharif</option>
                                <option value="rabi" ${state.currentSeason==='rabi'?'selected':''}>Rabi</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label class="block font-heading font-bold text-soil flex justify-between mb-4">
                            ${t('setup_irrigation')}
                            <span class="text-sm font-body font-normal opacity-70" id="irr-val">${Math.round(state.simulationConfig.irrigation_level*100)}% Coverage</span>
                        </label>
                        <input type="range" id="irr-input" min="0" max="1" step="0.1" value="${state.simulationConfig.irrigation_level}" class="w-full" />
                    </div>
                </div>

                <button id="save-setup-btn" class="clay-btn w-full py-4 text-lg mt-4 disabled:opacity-50 disabled:cursor-not-allowed" ${!state.currentRegion?'disabled':''}>
                    ${t('setup_save')}
                </button>
            </div>

            <!-- Right Side Preview & Environment Card -->
            <div class="lg:col-span-7 flex flex-col gap-6">
                <!-- Live Environment Clay Card -->
                <div class="clay-card p-10 min-h-[300px] flex flex-col justify-center relative overflow-hidden h-full rounded-blob">
                    ${state.currentRegion && state.weather && state.soil ? `
                        <div class="flex items-center gap-4 mb-6">
                            <i data-lucide="map-pin" class="text-terracotta"></i>
                            <h3 class="font-heading text-2xl font-bold">${regions.find(r=>r.id===state.currentRegion)?.name} Baseline</h3>
                        </div>
                        <div class="grid grid-cols-2 gap-6">
                            <div class="clay-input-well flex items-center justify-between pointer-events-none">
                                <span class="text-sm">Rainfall (mm)</span>
                                <span class="font-bold font-heading tabular-nums text-lg">${state.weather.rainfall_mm}</span>
                            </div>
                            <div class="clay-input-well flex items-center justify-between pointer-events-none">
                                <span class="text-sm">Temp (°C)</span>
                                <span class="font-bold font-heading tabular-nums text-lg">${state.weather.avg_temp_c || state.weather.temperature_c}</span>
                            </div>
                            <div class="clay-input-well flex items-center justify-between pointer-events-none">
                                <span class="text-sm text-terracotta">Soil pH</span>
                                <span class="font-bold font-heading tabular-nums text-lg text-terracotta">${state.soil.ph}</span>
                            </div>
                            <div class="clay-input-well flex items-center justify-between pointer-events-none">
                                <span class="text-sm text-saffron">NPK Profile</span>
                                <span class="font-bold font-heading text-sm text-saffron">${Math.round(state.soil.n_kg_per_acre)}:${Math.round(state.soil.p_kg_per_acre)}:${Math.round(state.soil.k_kg_per_acre)}</span>
                            </div>
                        </div>
                    ` : `
                        <div class="text-center opacity-40">
                            <i data-lucide="sun-dim" class="w-16 h-16 mx-auto mb-4 text-soil"></i>
                            <h3 class="text-2xl font-heading font-bold text-soil">Awaiting Environment</h3>
                            <p class="mt-2 text-sm max-w-sm mx-auto">Select your zone to sync local climate and telemetry.</p>
                        </div>
                    `}
                </div>

                <!-- Smart Recommendations Widget -->
                ${state.recommendedCrops.length > 0 ? `
                    <div class="bg-clay-deep/40 rounded-clay p-6 border-2 border-clay-deep/60">
                        <h4 class="font-heading font-bold text-soil mb-4 flex items-center gap-2">
                            <i data-lucide="sparkles" class="text-saffron w-5 h-5"></i> Smart Agronomy Specs
                        </h4>
                        <div class="flex flex-wrap gap-3">
                            ${recommendationChips}
                        </div>
                    </div>
                ` : ''}
            </div>
        </main>
    `;

    document.getElementById('irr-input').addEventListener('input', (e) => {
        document.getElementById('irr-val').textContent = `${Math.round(e.target.value*100)}% Coverage`;
    });

    document.getElementById('season-select').addEventListener('change', (e) => {
        state.currentSeason = e.target.value;
        if(state.currentRegion) triggerRegionLoad(state.currentRegion);
    });

    document.getElementById('region-select').addEventListener('change', async (e) => {
        triggerRegionLoad(e.target.value);
    });

    async function triggerRegionLoad(regionId) {
        state.currentRegion = regionId;
        try {
            document.getElementById('app-content').style.opacity = '0.5';
            const [wReq, sReq] = await Promise.all([
                api.get(`/weather/${regionId}?season=${state.currentSeason}`),
                api.get(`/soil/${regionId}`)
            ]);
            state.weather = wReq;
            state.soil = sReq;

            // Fetch generic smart recommendations in background
            try {
                const recs = await api.post('/recommend', {
                    region_id: state.currentRegion,
                    season: state.currentSeason,
                    budget_per_acre: state.simulationConfig.budget_per_acre,
                    area_acres: state.simulationConfig.area_acres
                });
                state.recommendedCrops = Array.isArray(recs) ? recs.slice(0, 3) : (recs.recommendations || []).slice(0, 3);
            } catch(e) { }

            renderFarmSetup(container); // Refresh UI with Data
            setTimeout(() => document.getElementById('app-content').style.opacity = '1', 50);
        } catch(err) {
            alert('Could not sync location datasets.');
            document.getElementById('app-content').style.opacity = '1';
        }
    }

    const btn = document.getElementById('save-setup-btn');
    if(btn) {
        btn.addEventListener('click', () => {
            btn.classList.add('active'); // active shadow inversion
            state.simulationConfig.area_acres = parseFloat(document.getElementById('area-input').value);
            state.simulationConfig.irrigation_level = parseFloat(document.getElementById('irr-input').value);
            setTimeout(() => { window.location.hash = '/strategy'; }, 150);
        });
    }
}


// ==========================================
// 3. Strategy Builder (#/strategy)
// ==========================================
async function renderStrategyBuilder(container) {
    if (!state.currentRegion) {
        window.location.hash='/setup';
        return;
    }

    if (state.crops.length === 0) {
        state.crops = await api.get('/crops');
    }

    const filteredCrops = state.crops.filter(c => c.season.toLowerCase() === state.currentSeason.toLowerCase() || c.season.toLowerCase() === 'all year');

    const cropCards = filteredCrops.map(c => `
        <div class="clay-card interactive p-6 cursor-pointer text-center relative overflow-hidden transition-all ${state.selectedCropId === c.crop_id ? '!bg-moss/10 shadow-clay-inset' : ''}" data-id="${c.crop_id}" tabindex="0">
            ${state.selectedCropId === c.crop_id ? '<div class="absolute top-3 right-3 text-moss"><i data-lucide="check-circle" class="w-5 h-5"></i></div>' : ''}
            <div class="crop-badge w-12 h-12 rounded-full mx-auto flex items-center justify-center text-xl mb-3 shadow-clay">
                ${cropDecorators[c.crop_id]||'🌱'}
            </div>
            <h3 class="font-heading font-bold text-soil">${c.crop_name}</h3>
        </div>
    `).join('');

    container.innerHTML = `
        <main class="relative px-6 py-12 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 mt-8">
            
            <div class="lg:col-span-8">
                <h2 class="text-4xl font-heading font-bold text-soil mb-8 flex items-center gap-3">
                    <i data-lucide="scroll"></i> Seed Catalog 
                    <span class="text-lg font-body font-normal opacity-50 bg-clay-surface shadow-clay-inset px-3 py-1 rounded-full text-sm mt-1 uppercase">${state.currentSeason}</span>
                </h2>
                
                ${filteredCrops.length === 0 ? '<p class="text-risk-rust bg-[#fceceb] p-4 rounded-clay">No records found for this season.</p>' : ''}
                
                <div class="grid grid-cols-2 md:grid-cols-3 gap-6" id="crop-grid">
                    ${cropCards}
                </div>
            </div>

            <!-- Sticky Builder Panel -->
            <div class="lg:col-span-4 mt-8 lg:mt-0">
                <div class="clay-card p-8 sticky top-36">
                    <h3 class="text-2xl font-heading font-bold text-soil mb-6">Build Plan</h3>
                    
                    <div class="space-y-6">
                        <div>
                            <label class="block font-heading font-bold text-soil mb-3">${t('str_variety')}</label>
                            <div class="flex gap-2 bg-clay-deep p-1.5 rounded-2xl shadow-clay-inset">
                                <button id="var-standard" class="flex-1 py-2 px-4 rounded-xl text-sm font-bold transition-all ${state.simulationConfig.seed_variety==='standard'?'bg-clay-surface shadow-clay text-soil':'text-soil/50 hover:text-soil'}">Standard</button>
                                <button id="var-hybrid" class="flex-1 py-2 px-4 rounded-xl text-sm font-bold transition-all ${state.simulationConfig.seed_variety==='hybrid'?'bg-clay-surface shadow-clay text-soil':'text-soil/50 hover:text-soil'}">HYV / Hybrid</button>
                            </div>
                        </div>

                        <div>
                            <label class="block font-heading font-bold text-soil mb-3">${t('str_budget')}</label>
                            <div class="relative">
                                <span class="absolute left-4 top-[14px] font-bold text-soil/50">₹</span>
                                <input type="number" id="budget-input" value="${state.simulationConfig.budget_per_acre}" class="clay-input-well pl-8 tabular-nums font-bold" />
                            </div>
                        </div>
                    </div>

                    <div class="mt-8 pt-6 border-t border-clay-deep/50">
                        <button id="run-sim-btn" class="clay-btn w-full py-4 text-lg items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed" ${!state.selectedCropId?'disabled':''}>
                            <i data-lucide="play" class="w-5 h-5"></i> ${t('str_run')}
                        </button>
                    </div>
                </div>
            </div>
        </main>
    `;

    // Setup toggles and bindings
    document.getElementById('var-standard').addEventListener('click', () => { state.simulationConfig.seed_variety = 'standard'; renderStrategyBuilder(container); });
    document.getElementById('var-hybrid').addEventListener('click', () => { state.simulationConfig.seed_variety = 'hybrid'; renderStrategyBuilder(container); });

    document.querySelectorAll('.crop-select, .interactive[data-id]').forEach(card => {
        card.addEventListener('click', () => {
            state.selectedCropId = card.getAttribute('data-id');
            renderStrategyBuilder(container);
        });
    });

    const runBtn = document.getElementById('run-sim-btn');
    if(runBtn) {
        runBtn.addEventListener('click', async () => {
            runBtn.classList.add('active');
            state.simulationConfig.budget_per_acre = parseFloat(document.getElementById('budget-input').value);
            
            // Switch UI to active loading mode
            runBtn.innerHTML = '<i data-lucide="loader-2" class="animate-spin w-5 h-5"></i> Running...';
            document.getElementById('app-content').style.opacity = '0.6';

            try {
                // Fetch dynamic mandi price for accuracy
                const prices = await api.get(`/mandi-prices/${state.currentRegion}?crop_id=${state.selectedCropId}`);
                const latestPrice = prices.length > 0 ? parseFloat(prices[prices.length-1].price_inr_per_kg) : 25.0;

                // Force numeric casting on raw CSV strings to prevent python backend engine crashes
                const castNumericValues = (obj) => {
                    let out = {};
                    for(let k in obj) {
                        out[k] = isNaN(parseFloat(obj[k])) ? obj[k] : parseFloat(obj[k]);
                    }
                    return out;
                };

                const reqBody = {
                    crop_id: state.selectedCropId,
                    area_acres: state.simulationConfig.area_acres,
                    region_id: state.currentRegion,
                    mandi_price_per_kg: latestPrice,
                    irrigation_level: state.simulationConfig.irrigation_level,
                    seed_variety: state.simulationConfig.seed_variety,
                    sowing_date: state.simulationConfig.sowing_date,
                    weather: castNumericValues(state.weather || {}),
                    soil: castNumericValues(state.soil || {}),
                    input_plan: {
                        fertilizer_cost_per_acre: state.simulationConfig.budget_per_acre * 0.45,
                        seed_cost_per_acre: state.simulationConfig.budget_per_acre * 0.15,
                        labour_cost_per_acre: state.simulationConfig.budget_per_acre * 0.40
                    }
                };

                const result = await api.post('/simulate', reqBody);
                state.lastSimulationResult = { request: reqBody, result: result, timestamp: Date.now() };
                state.savedStrategies.push(state.lastSimulationResult); // Auto-journal

                // Done, route to results securely
                document.getElementById('app-content').style.opacity = '1';
                window.location.hash = '/results';
            } catch(e) {
                alert("Simulator Error: " + e.message);
                renderStrategyBuilder(container);
            }
        });
    }
}


// ==========================================
// 4. Simulation Results (#/results)
// ==========================================
async function renderSimulationResults(container) {
    if(!state.lastSimulationResult) {
        window.location.hash = '/strategy';
        return;
    }

    const { result: res, request: req } = state.lastSimulationResult;
    const crop = state.crops.find(c => c.crop_id === res.crop_id);
    const emoji = cropDecorators[res.crop_id] || '🌱';
    
    // assumptions markup mapping
    const assumptionsHtml = res.assumptions.map(msg => `<li class="flex gap-2 items-start text-sm bg-clay-surface p-3 rounded-2xl border-l-[3px] border-terracotta"><i data-lucide="info" class="w-4 h-4 mt-0.5 opacity-50 shrink-0"></i> <span>${msg}</span></li>`).join('');

    container.innerHTML = `
        <main class="relative px-6 py-12 max-w-7xl mx-auto w-full mt-6">
            
            <header class="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
                <div class="flex items-end gap-6">
                    <div class="w-20 h-20 rounded-full crop-badge flex items-center justify-center text-4xl shadow-clay">
                        ${emoji}
                    </div>
                    <div>
                        <div class="flex gap-3 mb-2">
                            <span class="bg-clay-surface shadow-clay-inset px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-saffron">${req.area_acres} Acres</span>
                            <span class="bg-clay-surface shadow-clay-inset px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-saffron font-body">${req.seed_variety}</span>
                        </div>
                        <h1 class="text-4xl md:text-5xl font-heading font-black tracking-tight text-soil">
                            ${crop?.crop_name || res.crop_id} Yield Cast
                        </h1>
                    </div>
                </div>
                
                <button onclick="window.location.hash='/compare'" class="clay-btn px-6 py-3 shrink-0">
                    <i data-lucide="book-copy" class="w-4 h-4"></i> ${t('res_compare_btn')}
                </button>
            </header>

            <!-- Metrics Top Bar -->
            <section class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
                <div class="clay-card p-6 flex flex-col justify-center rounded-[2rem]">
                    <p class="text-sm font-bold text-bark/60 uppercase tracking-widest mb-2">${t('res_yield')}</p>
                    <p class="text-3xl font-bold font-heading text-moss tabular-nums">${res.total_yield_kg.toLocaleString()} <span class="text-lg font-body opacity-50">kg</span></p>
                </div>
                <div class="clay-card p-6 flex flex-col justify-center rounded-[2rem]">
                    <p class="text-sm font-bold text-bark/60 uppercase tracking-widest mb-2">${t('res_cost')}</p>
                    <p class="text-3xl font-bold font-heading text-terracotta tabular-nums">${formatCurrency(res.total_cost)}</p>
                </div>
                <div class="clay-card p-6 flex flex-col justify-center rounded-[2rem] bg-moss/10 shadow-clay-inset border border-moss/10">
                    <p class="text-sm font-bold text-moss uppercase tracking-widest mb-2">${t('res_profit')}</p>
                    <p class="text-3xl font-bold font-heading text-soil tabular-nums underline decoration-moss/30 underline-offset-4">${formatCurrency(res.profit)}</p>
                </div>
                <div class="clay-card p-6 flex flex-col justify-center rounded-[2rem]">
                    <p class="text-sm font-bold text-bark/60 uppercase tracking-widest mb-2">${t('res_roi')}</p>
                    <p class="text-3xl font-bold font-heading text-saffron tabular-nums">${res.roi_percent}%</p>
                </div>
            </section>

            <!-- Charts & Details Grid -->
            <section class="grid lg:grid-cols-3 gap-8">
                
                <!-- Doughnut Card -->
                <div class="clay-card p-8 rounded-blob-alt lg:col-span-1">
                    <h3 class="font-heading border-b border-clay-deep/50 pb-4 mb-6 text-xl font-bold">Input Cost Breakdown</h3>
                    <div class="relative max-w-[280px] mx-auto w-full aspect-square">
                        <!-- ChartJS visually hidden labels applied automatically by ARIA plugins if configured, but canvas contains it -->
                        <canvas id="costDoughnut" aria-label="Donut chart showing proportional costs of inputs like fertilizer and seed"></canvas>
                    </div>
                </div>

                <!-- Radar Card -->
                <div class="clay-card p-8 rounded-[2rem] lg:col-span-1 flex flex-col items-center shrink-0">
                    <h3 class="font-heading w-full border-b border-clay-deep/50 pb-4 mb-6 text-xl font-bold flex justify-between">
                        Agronomic Risk 
                        <span class="text-risk-rust bg-[#fceceb] px-3 py-0.5 rounded-full text-base">${res.risk_score}</span>
                    </h3>
                    <div class="relative w-full aspect-square mt-auto shrink-0 max-w-[320px]">
                        <canvas id="riskRadar" aria-label="Radar chart showing categorical risk potentials like drought or pests"></canvas>
                    </div>
                </div>

                <!-- Assumptions Journal -->
                <div class="clay-card p-8 rounded-blob lg:col-span-1 shadow-clay-inset bg-clay-surface shrink-0 h-full overflow-hidden flex flex-col">
                    <h3 class="font-heading border-b border-clay-deep/50 pb-4 mb-6 text-xl font-bold flex items-center gap-2"><i data-lucide="book-open"></i> Engine Assumptions</h3>
                    <ul class="space-y-4 font-medium flex-grow overflow-y-auto pr-2 custom-scrollbar">
                        ${assumptionsHtml}
                    </ul>
                </div>

            </section>
        </main>
    `;

    setTimeout(() => {
        // Doughnut settings requested: 75% cutout, 6px spacing, explicit palette.
        new Chart(document.getElementById('costDoughnut').getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: Object.keys(res.cost_breakdown_per_acre).map(k => k.replace(/_/g, ' ').toUpperCase()),
                datasets: [{
                    data: Object.values(res.cost_breakdown_per_acre),
                    backgroundColor: CH_COLORS,
                    borderWidth: 6,
                    borderColor: '#FBF6EA',
                    hoverOffset: 4
                }]
            },
            options: {
                cutout: '75%',
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: {family: 'Quicksand', weight:'bold'} } }
                }
            }
        });

        // Radar settings requested: no axes, specific moss fills
        new Chart(document.getElementById('riskRadar').getContext('2d'), {
            type: 'radar',
            data: {
                labels: ['🌵 Drought', '🌧 Flood', '🐛 Pest', '📉 Price'],
                datasets: [{
                    label: 'Risk %',
                    data: [res.risk_subscores.drought, res.risk_subscores.flood, res.risk_subscores.pest, res.risk_subscores.price_volatility],
                    backgroundColor: 'rgba(92, 122, 74, 0.25)', // moss @ 25%
                    borderColor: '#3F5A33', // moss-deep
                    pointBackgroundColor: '#3F5A33',
                    pointRadius: 5,
                    borderWidth: 2
                }]
            },
            options: {
                scales: {
                    r: {
                        min: 0, max: 100,
                        ticks: { display: false, maxTicksLimit: 5 }, // No axis numbers
                        grid: { color: '#E8DCC0' }, // clay-deep
                        pointLabels: { font: { family: 'Quicksand', size: 14, weight: 'bold' }, color: '#3B2E25' },
                        angleLines: { color: '#E8DCC0' }
                    }
                },
                plugins: { legend: { display: false } }
            }
        });
    }, 150);
}


// ==========================================
// 5. Strategy Comparison (#/compare)
// ==========================================
async function renderCompare(container) {
    if (state.savedStrategies.length < 1) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-40 max-w-md mx-auto text-center gap-6">
                <i data-lucide="book-dashed" class="w-16 h-16 text-clay-deep"></i>
                <p class="font-heading text-xl text-soil">${t('cmp_empty')}</p>
                <button onclick="window.location.hash='/strategy'" class="clay-btn px-6 py-3">${t('cmp_build_new')}</button>
            </div>
        `;
        return;
    }

    const cardsHtml = state.savedStrategies.map((s, i) => {
        const res = s.result;
        return `
        <div class="clay-card p-6 flex flex-col justify-between interactive cursor-default">
            
            <div class="flex items-center gap-4 mb-6">
                <div class="w-12 h-12 rounded-full crop-badge flex items-center justify-center text-xl shadow-clay">
                    ${cropDecorators[res.crop_id]||'🌱'}
                </div>
                <div>
                    <h3 class="font-heading font-black text-xl text-soil">${res.crop_id.toUpperCase()}</h3>
                    <p class="text-xs font-bold text-bark/60">Strat #${i+1} • ${res.area_acres} Ac</p>
                </div>
            </div>

            <div class="space-y-3 font-body font-bold text-sm bg-clay-deep/20 p-4 rounded-xl shadow-clay-inset">
                <div class="flex justify-between border-b border-clay-deep/50 pb-2">
                    <span class="text-bark/70">Yield</span>
                    <span class="tabular-nums text-soil">${res.total_yield_kg} kg</span>
                </div>
                <div class="flex justify-between border-b border-clay-deep/50 pb-2">
                    <span class="text-bark/70">Cost</span>
                    <span class="tabular-nums text-terracotta">${formatCurrency(res.total_cost)}</span>
                </div>
                <div class="flex justify-between border-b border-clay-deep/50 pb-2 text-base">
                    <span class="text-bark">Profit</span>
                    <span class="tabular-nums text-moss underline decoration-moss/50 underline-offset-2">${formatCurrency(res.profit)}</span>
                </div>
                <div class="flex justify-between pt-1">
                    <span class="text-bark/70">ROI</span>
                    <span class="tabular-nums text-saffron text-base">${res.roi_percent}%</span>
                </div>
            </div>

        </div>
        `;
    }).join('');

    container.innerHTML = `
        <main class="relative px-6 py-12 max-w-7xl mx-auto w-full mt-6">
            <header class="text-center mb-16">
                <h1 class="text-4xl md:text-5xl font-heading font-black tracking-tight text-soil mb-4">Comparison Journal</h1>
                <p class="text-lg text-bark/80 max-w-2xl mx-auto">Evaluating ${state.savedStrategies.length} unique simulation entries.</p>
                <button onclick="window.location.hash='/strategy'" class="mt-6 font-bold text-moss border-b border-moss pb-1 hover:text-moss-deep transition-colors">+ Add to journal</button>
            </header>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
                ${cardsHtml}
            </div>
            
            <div class="clay-card p-8 rounded-[2.5rem]">
                <h3 class="font-heading font-bold text-xl mb-6 text-soil">Risk vs. Reward Spectrum</h3>
                <div class="relative w-full h-[400px]">
                    <!-- Grouped Bar Chart -->
                    <canvas id="compareBarChart"></canvas>
                </div>
            </div>
        </main>
    `;

    setTimeout(() => {
        const labels = state.savedStrategies.map((s,i) => `S${i+1}: ${s.result.crop_id}`);
        
        new Chart(document.getElementById('compareBarChart').getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Risk Score (Lower is Safer)',
                        data: state.savedStrategies.map(s => s.result.risk_score),
                        backgroundColor: '#C97B5C', // terracotta
                        borderRadius: 12,
                        barPercentage: 0.6
                    },
                    {
                        label: 'ROI % (Higher is Better)',
                        data: state.savedStrategies.map(s => s.result.roi_percent),
                        backgroundColor: '#5C7A4A', // moss
                        borderRadius: 12,
                        barPercentage: 0.6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#E8DCC0' }, // shadow colors
                        ticks: { font: { family: 'Quicksand', weight:'bold' } }
                    },
                    x: {
                        grid: { display:false },
                        ticks: { font: { family: 'Quicksand', weight:'bold' } }
                    }
                },
                plugins: {
                    tooltip: { backgroundColor: '#3B2E25', titleFont: {family: 'Fraunces'}, padding: 12, cornerRadius: 8 }
                }
            }
        });
    }, 150);
}
