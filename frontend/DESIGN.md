# 🌾 Earthy Claymorphism - Design System & Component Library

## Overarching Vision
This UI moves away from sterile SaaS flatness, offering warmth, tactility, and the grounded feel of a working digital field journal. The interface features heavily rounded, organic borders and complex drop-shadow injections to mimic light hitting clay.

## 🎨 Color Palette & TailWind Tokens

| Token | Hex | Usage | Tailwind Variable |
|-------|-----|-------|--------------------|
| **Clay Bg** | `#F4ECDD` | Base page background (warm cream) | `bg-clay-bg` |
| **Clay Surface** | `#FBF6EA` | Main elements, cards | `bg-clay-surface` |
| **Clay Deep** | `#E8DCC0` | Inset wells, sliders | `bg-clay-deep` |
| **Moss** | `#5C7A4A` | Primary calls to action | `bg-moss text-moss` |
| **Moss Deep** | `#3F5A33` | Hover/Pressed states | `text-moss-deep` |
| **Terracotta** | `#C97B5C` | Secondary accents, warnings | `text-terracotta` |
| **Saffron** | `#E0A458` | Highlights, ROI presentation | `text-saffron` |
| **Soil** | `#6B4F3A` | Important Headings | `text-soil` |
| **Bark** | `#3B2E25` | Default body text | `text-bark` |
| **Risk Rust** | `#A4453A` | High risk metric blocks | `text-risk-rust` |
| **Sky Wash** | `#A9C4C2` | Tertiary accent for charts | `text-sky-wash` |

## 📦 The "Squeezed Clay" Shadow Recipe
The entire visual style rests on these Tailwind utility classes overriding standard shadows to imitate organic molded objects. 

```css
/* Tailwind Class: shadow-clay */
box-shadow: 
  8px 8px 20px rgba(107, 79, 58, 0.18), 
 -6px -6px 16px rgba(255, 250, 235, 0.95), 
  inset 1px 1px 2px rgba(255,255,255,0.6);

/* Tailwind Class: shadow-clay-inset (For active states and Input Wells) */
box-shadow: 
  inset 8px 8px 20px rgba(107, 79, 58, 0.12), 
  inset -6px -6px 16px rgba(255, 250, 235, 0.95);
```

## 🧩 Component Anatomy

### 1. `clay-card`
- Basic elevated container. Uses `bg-clay-surface`, `rounded-clay` (28px), and `shadow-clay`. 
- **Interactive Variant (`.clay-card.interactive`)**: Has a hover lift that amplifies the shadow slightly, creating a 3D float effect.

### 2. `clay-btn`
- The primary action component. Uses the Moss palette.
- Automatically handles three states: rest (extruded), hover (high-float), active (inset press).

### 3. `clay-input-well`
- Used for textual `<input>` or `<select>` menus.
- It sinks into the page using `shadow-clay-inset` and `bg-clay-deep`.

### 4. `crop-badge`
- Circular tokens using CSS gradients to look molded alongside the cards. Utilizes Lucide icons or raw emojis.

## 🔗 Endpoint Integration Checklist (Which API does which screen consume?)

**1. Landing (`#/`)**
- `GET /api/crops` (Fetches the dynamic catalog for the grid)

**2. Farm Setup (`#/setup`)**
- `GET /api/regions` (Populates dropdown)
- `GET /api/weather/{region_id}?season="..."` (Telemetry data for Environment widget)
- `GET /api/soil/{region_id}` (Soil parameters for Environment widget)
- `POST /api/recommend` (Fuels the Smart Recommendations chips using parameters like area and budget)

**3. Strategy Builder (`#/strategy`)**
- `GET /api/crops` (Renders selection tiles)
- `GET /api/mandi-prices/{region_id}?crop_id="..."` (Secures current dynamic pricing before triggering the simulation engine)
- `POST /api/simulate` (Submits the strategy to the Python Simulation Engine)

**4. Simulation Results (`#/results`)**
- Requires state transfer from `/strategy`
- Visualizes the `cost_breakdown_per_acre` via a customized ChartJS doughnut. 
- Visualizes the `risk_subscores` via a custom, axis-free ChartJS radar graphic.

**5. Compare (`#/compare`)**
- Relies on JS Local Session State array mapping multiple previously executed strategies into grouped bar charts and side-by-side clay cards.
