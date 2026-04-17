"""
Mitti Mantra site-aware chatbot.

A lightweight, intent-based conversational layer "fine-tuned" to this platform:
it understands the site's domain (crops, regions, mandi prices, MSP, schemes,
recommendations, simulation, rotation, irrigation, pests, loans) and answers
using the EXACT same engine + datasets the rest of the app uses — no
hallucinations, no external LLM required.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from engine.features import (
    best_time_to_sell,
    get_crop_calendar,
    get_msp_data,
    irrigation_schedule,
    loan_calculator,
    match_government_schemes,
    msp_vs_market,
    pest_disease_alerts,
)
from ml.predict import recommend_crops
from utils.csv_cache import load as _csv_load

# ---------------------------------------------------------------------------
# Data accessors — all backed by the shared mtime-aware CSV cache so the
# chatbot always reflects the latest dataset without a server restart.
# ---------------------------------------------------------------------------
def _crops() -> List[Dict[str, str]]:   return _csv_load("crop_parameters.csv")
def _soil() -> List[Dict[str, str]]:    return _csv_load("soil.csv")
def _mandi() -> List[Dict[str, str]]:   return _csv_load("mandi_prices.csv")


def _crop_by_id() -> Dict[str, Dict[str, str]]:
    return {c["crop_id"].lower(): c for c in _crops()}


def _crop_by_name() -> Dict[str, Dict[str, str]]:
    return {c["crop_name"].lower(): c for c in _crops()}


def _regions() -> List[str]:
    return sorted({r["region_id"] for r in _soil()})



# ---------------------------------------------------------------------------
# Site knowledge base (what the bot knows about the product itself)
# ---------------------------------------------------------------------------
FEATURES_OVERVIEW = [
    ("Smart crop recommendations", "AI ranks the best crops for your region, season, budget and land area."),
    ("Yield & profit simulator", "Physics + ML based yield forecasting with a full cost/profit breakdown."),
    ("Crop rotation planner", "Optimal Kharif → Rabi rotation plans for soil health and profit."),
    ("Mandi price analytics", "Trend, volatility, seasonality and 6-month price forecast for every crop."),
    ("MSP comparison", "Check MSP vs current mandi price so you never sell below support price."),
    ("Cross-mandi arbitrage", "See price gaps between mandis to transport produce where it pays more."),
    ("Irrigation schedule", "Week-by-week irrigation plan tuned to rainfall and crop stage."),
    ("Pest & disease alerts", "Weather-driven early warnings for your crop."),
    ("Fertilizer recommendation", "Exact N-P-K dosage based on your soil test and the crop."),
    ("Loan & EMI calculator", "Check loan feasibility against expected profit."),
    ("Government schemes", "Match eligible central/state schemes by crop, region and land size."),
    ("Expense tracker", "Log and compare actual vs planned spend per farm."),
    ("3D farm visualisation", "Interactive 3D scene of your farm and India-wide crop map."),
    ("Draw-your-farm tool", "Sketch your plot boundary to auto-estimate area and geolocation."),
]

GREETINGS = ("hi", "hii", "hello", "hey", "namaste", "namaskar", "salaam", "vanakkam", "hola")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _find_crop(text: str) -> Optional[Dict[str, str]]:
    t = text.lower()
    # Prefer longer names first (e.g. "black gram" before "gram")
    for name, row in sorted(_crop_by_name().items(), key=lambda kv: -len(kv[0])):
        if name in t:
            return row
    for cid, row in sorted(_crop_by_id().items(), key=lambda kv: -len(kv[0])):
        if re.search(rf"\b{re.escape(cid)}\b", t):
            return row
    return None


def _find_region(text: str) -> Optional[str]:
    t = text.lower().replace(" ", "_")
    for rid in sorted(_regions(), key=len, reverse=True):
        if rid.lower() in t:
            return rid
        # also allow matching just the district part: "medak" -> telangana_medak
        district = rid.split("_", 1)[-1]
        if district and re.search(rf"\b{re.escape(district)}\b", text.lower()):
            return rid
    return None


def _find_season(text: str) -> Optional[str]:
    t = text.lower()
    if "kharif" in t or "monsoon" in t:
        return "kharif"
    if "rabi" in t or "winter" in t:
        return "rabi"
    if "zaid" in t or "summer" in t:
        return "zaid"
    return None


_NUM_RE = re.compile(r"(\d[\d,]*\.?\d*)")


def _find_numbers(text: str) -> List[float]:
    nums = []
    for m in _NUM_RE.finditer(text):
        try:
            nums.append(float(m.group(1).replace(",", "")))
        except ValueError:
            pass
    return nums


def _fmt_inr(v: float) -> str:
    return f"₹{v:,.0f}"


# ---------------------------------------------------------------------------
# Intent handlers  -> return (reply_markdown, suggestions)
# ---------------------------------------------------------------------------
Reply = Tuple[str, List[str]]


def _action(label: str, href: str) -> Dict[str, str]:
    return {"label": label, "href": href}


def _dashboard_link(tool: str, **params: Any) -> str:
    from urllib.parse import urlencode
    qs = urlencode({k: v for k, v in params.items() if v is not None})
    return f"/dashboard.html?tool={tool}&{qs}" if qs else f"/dashboard.html?tool={tool}"


def _intent_greeting() -> Reply:
    msg = (
        "Namaste! I'm **Mitti Mantra's assistant** — I can help you with crop "
        "recommendations, mandi prices, MSP, irrigation, pests, government "
        "schemes and more, using real Indian farm data.\n\n"
        "Try asking: _\"Recommend crops for Telangana Medak in Kharif with "
        "₹15000 budget on 3 acres\"_ or _\"What's the MSP of wheat?\"_"
    )
    return msg, [
        "What can you do?",
        "Recommend crops for my region",
        "MSP of wheat",
        "List regions",
    ]


def _intent_help() -> Reply:
    lines = ["Here's what I can do on **Mitti Mantra**:\n"]
    for title, desc in FEATURES_OVERVIEW:
        lines.append(f"- **{title}** — {desc}")
    lines.append(
        "\nAsk me in plain English — e.g. _\"pest alerts for rice\"_ or "
        "_\"best time to sell cotton in Maharashtra Yavatmal\"_."
    )
    return "\n".join(lines), [
        "Recommend crops",
        "Mandi price of tomato",
        "Pest alerts for rice",
        "Government schemes",
    ]


def _intent_list_crops() -> Reply:
    crops = _crops()
    if not crops:
        return "No crop data is loaded on the server.", []
    names = [c["crop_name"] for c in crops]
    msg = f"I have data on **{len(names)} crops**:\n\n" + ", ".join(names)
    return msg, ["Tell me about rice", "MSP of wheat", "Recommend crops"]


def _intent_list_regions() -> Reply:
    regs = _regions()
    if not regs:
        return "No region data is loaded on the server.", []
    pretty = ", ".join(r.replace("_", " · ").title() for r in regs)
    return (
        f"I have soil + weather data for **{len(regs)} regions**:\n\n{pretty}",
        ["Recommend for Telangana Medak", "Mandi prices in MP Sehore"],
    )


def _intent_about_crop(crop: Dict[str, str]) -> Reply:
    c = crop
    msg = (
        f"### {c['crop_name']} ({c['crop_id']})\n"
        f"- **Season:** {c['season']}\n"
        f"- **Base yield:** {c['base_yield_kg_per_acre']} kg / acre\n"
        f"- **Water need:** {c['water_requirement_mm']} mm\n"
        f"- **NPK (kg/acre):** {c['npk_n_kg_per_acre']} - {c['npk_p_kg_per_acre']} - {c['npk_k_kg_per_acre']}\n"
        f"- **Temperature band:** {c['temp_min_c']}–{c['temp_max_c']} °C\n"
        f"- **Avg input cost:** {_fmt_inr(float(c['avg_input_cost_inr_per_acre']))}/acre\n"
        f"- **Mandi price range:** ₹{c['mandi_price_min_inr_per_kg']}–{c['mandi_price_max_inr_per_kg']}/kg"
    )
    cid = c["crop_id"]
    return msg, [f"MSP of {c['crop_name']}", f"Pest alerts for {cid}", f"Irrigation schedule for {cid}"]


def _intent_msp(crop: Optional[Dict[str, str]]) -> Reply:
    data = get_msp_data(crop["crop_id"] if crop else None)
    if not data:
        return "I couldn't find MSP data for that crop.", ["MSP of wheat", "MSP of rice"]
    if crop:
        latest = data[-1] if isinstance(data, list) else data
        if isinstance(latest, dict):
            price = latest.get("msp_inr_per_quintal") or latest.get("msp_per_quintal") or latest
            return (
                f"**MSP for {crop['crop_name']}** (latest): ₹{price}/quintal.",
                [f"MSP vs market for {crop['crop_id']}", f"Best time to sell {crop['crop_id']}"],
            )
    sample = data[:6] if isinstance(data, list) else [data]
    return f"Here's the MSP data I have:\n\n```json\n{sample}\n```", []


def _intent_mandi_price(crop: Optional[Dict[str, str]], region: Optional[str]) -> Reply:
    rows = _mandi()
    if crop:
        rows = [r for r in rows if r["crop_id"] == crop["crop_id"]]
    if region:
        rows = [r for r in rows if r["region_id"] == region]
    if not rows:
        return (
            "I couldn't find mandi prices for that combination. Try naming a "
            "specific crop and region.",
            ["Mandi price of onion in MP Sehore", "List regions"],
        )
    rows = rows[-6:]
    lines = ["Recent mandi prices:\n"]
    for r in rows:
        lines.append(
            f"- **{r.get('crop_id','?')}** @ {r.get('region_id','?')} "
            f"({r.get('date') or r.get('month','')}): ₹{r.get('price_inr_per_kg','?')}/kg"
        )
    tips = []
    if crop:
        tips.append(f"Price forecast for {crop['crop_id']}")
        tips.append(f"Best time to sell {crop['crop_id']}")
    return "\n".join(lines), tips


def _intent_recommend(region: Optional[str], season: Optional[str], nums: List[float]) -> Reply:
    if not region:
        return (
            "Tell me the **region** (e.g. _Telangana Medak_ or _MP Sehore_) "
            "and I'll recommend the best crops.",
            ["List regions", "Recommend for Telangana Medak in Kharif"],
        )
    season = season or "kharif"
    budget = nums[0] if nums else 15000.0
    area = nums[1] if len(nums) > 1 else 3.0
    try:
        recs = recommend_crops(region_id=region, season=season, budget_per_acre=budget, area_acres=area)
    except Exception as e:
        return f"Sorry, I couldn't compute recommendations: {e}", []
    if not recs:
        return f"No strong recommendations for {region} in {season}.", []
    lines = [
        f"Top crops for **{region.replace('_',' · ').title()}** in **{season.title()}** "
        f"(budget {_fmt_inr(budget)}/acre, {area} acres):\n"
    ]
    for i, r in enumerate(recs[:5], 1):
        lines.append(
            f"{i}. **{r.get('crop_name')}** — "
            f"profit {_fmt_inr(r.get('expected_profit',0))}, "
            f"ROI {r.get('roi_percent',0)}%, risk {r.get('risk_score',0)}/10"
        )
    return "\n".join(lines), [
        "Open dashboard",
        f"Rotation plan for {region}",
        f"Pest alerts for {recs[0].get('crop_id')}",
    ]


def _kv_list(d: Dict[str, Any], keys: Optional[List[str]] = None) -> str:
    items = keys if keys else list(d.keys())
    lines = []
    for k in items:
        if k not in d:
            continue
        v = d[k]
        if isinstance(v, float):
            v = f"{v:,.2f}".rstrip("0").rstrip(".")
        lines.append(f"- **{k.replace('_', ' ').title()}:** {v}")
    return "\n".join(lines)


def _intent_sell_advice(crop: Dict[str, str], region: Optional[str]) -> Reply:
    if not region:
        return "Which region? e.g. _\"best time to sell cotton in Maharashtra Yavatmal\"_.", []
    try:
        res = best_time_to_sell(region, crop["crop_id"])
    except Exception as e:
        return f"Couldn't compute sell advice: {e}", []
    rtxt = region.replace("_", " · ").title()
    lines = [f"### Sell advice — {crop['crop_name']} @ {rtxt}\n"]
    if isinstance(res, dict):
        if "recommendation" in res:
            lines.append(f"**Recommendation:** {res['recommendation']}\n")
        if "best_month" in res:
            lines.append(f"- **Best month to sell:** {res['best_month']}")
        if "best_price" in res:
            lines.append(f"- **Expected price:** ₹{res['best_price']:.2f}/kg")
        if "current_price" in res:
            lines.append(f"- **Current price:** ₹{res['current_price']:.2f}/kg")
        if "price_uplift_percent" in res:
            lines.append(f"- **Uplift vs today:** {res['price_uplift_percent']:+.1f}%")
        if "reasoning" in res:
            lines.append(f"\n_{res['reasoning']}_")
    else:
        lines.append(str(res))
    return "\n".join(lines), [
        f"Price forecast for {crop['crop_id']}",
        f"MSP vs market for {crop['crop_id']}",
    ]


def _intent_pest(crop: Dict[str, str]) -> Reply:
    try:
        alerts = pest_disease_alerts(crop["crop_id"], {"avg_temp_c": 28, "rainfall_mm": 800})
    except Exception as e:
        return f"Couldn't fetch pest alerts: {e}", []
    lines = [f"### Pest & disease risk — {crop['crop_name']}\n"]
    items = alerts if isinstance(alerts, list) else alerts.get("alerts", []) if isinstance(alerts, dict) else []
    sev_icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}
    if not items:
        lines.append("_No active pest risk signals for these conditions._")
    for a in items[:5]:
        name = a.get("pest_disease") or a.get("name", "Unknown")
        sev = (a.get("severity") or a.get("risk") or "medium").lower()
        icon = sev_icon.get(sev, "🟡")
        desc = a.get("description", "")
        mgmt = a.get("management") or a.get("action", "")
        lines.append(f"**{icon} {name}** _(severity: {sev})_")
        if desc:
            lines.append(f"- {desc}")
        if mgmt:
            lines.append(f"- _Action:_ {mgmt}")
        lines.append("")
    return "\n".join(lines).strip(), [
        f"Irrigation schedule for {crop['crop_id']}",
        f"Fertilizer for {crop['crop_id']}",
    ]


def _intent_irrigation(crop: Dict[str, str]) -> Reply:
    try:
        sch = irrigation_schedule(crop["crop_id"], "2025-06-15", 800, 0.5)
    except Exception as e:
        return f"Couldn't build schedule: {e}", []
    lines = [f"### Irrigation schedule — {crop['crop_name']}", "_Sown 15 Jun · 800 mm seasonal rainfall_\n"]
    weeks = sch if isinstance(sch, list) else sch.get("schedule", []) if isinstance(sch, dict) else []
    if weeks:
        lines.append("| Week | Stage | Water (mm) | Action |")
        lines.append("|---:|---|---:|---|")
        for w in weeks[:16]:
            wk = w.get("week") or w.get("week_number", "?")
            stage = w.get("stage", "—")
            water = w.get("irrigation_mm") or w.get("water_mm") or w.get("required_mm", 0)
            act = w.get("action") or w.get("note", "")
            lines.append(f"| {wk} | {stage} | {water} | {act} |")
        if isinstance(sch, dict) and sch.get("total_water_mm"):
            lines.append(f"\n**Total seasonal water:** {sch['total_water_mm']} mm")
    else:
        lines.append("_No schedule available._")
    return "\n".join(lines), [f"Pest alerts for {crop['crop_id']}", f"Crop calendar for {crop['crop_id']}"]


def _intent_calendar(crop: Dict[str, str]) -> Reply:
    try:
        cal = get_crop_calendar(crop["crop_id"])
    except Exception as e:
        return f"Couldn't fetch calendar: {e}", []
    lines = [f"### Crop calendar — {crop['crop_name']}\n"]
    if isinstance(cal, dict):
        for key in ("season", "sowing_window", "sowing_date", "transplanting", "flowering",
                    "harvest_window", "harvest_date", "duration_days", "growing_degree_days"):
            if key in cal:
                lines.append(f"- **{key.replace('_',' ').title()}:** {cal[key]}")
        acts = cal.get("activities") or cal.get("milestones")
        if isinstance(acts, list):
            lines.append("\n**Key activities:**")
            for a in acts[:10]:
                if isinstance(a, dict):
                    lines.append(f"- _{a.get('stage','—')}_ → {a.get('action') or a.get('date','')}")
                else:
                    lines.append(f"- {a}")
    else:
        lines.append(str(cal))
    return "\n".join(lines), [f"Irrigation schedule for {crop['crop_id']}", f"Pest alerts for {crop['crop_id']}"]


def _intent_schemes(crop: Optional[Dict[str, str]], region: Optional[str], nums: List[float]) -> Reply:
    area = nums[0] if nums else 3.0
    try:
        schemes = match_government_schemes(
            crop["crop_id"] if crop else "all",
            region or "all",
            area,
            "all",
        )
    except Exception as e:
        return f"Couldn't match schemes: {e}", []
    items = schemes if isinstance(schemes, list) else schemes.get("matches", []) if isinstance(schemes, dict) else []
    if not items:
        return "No matching government schemes found for this profile.", []
    lines = [f"### Eligible schemes for {area:.1f} acre farm\n"]
    for s in items[:8]:
        name = s.get("scheme_name") or s.get("name") or "Scheme"
        desc = s.get("description", "")
        benefit = s.get("benefit_inr") or s.get("benefit", "")
        link = s.get("apply_url") or s.get("url")
        lines.append(f"**📜 {name}**")
        if desc:
            lines.append(f"- {desc}")
        if benefit:
            lines.append(f"- **Benefit:** {benefit}")
        if link:
            lines.append(f"- [Apply here]({link})")
        lines.append("")
    return "\n".join(lines).strip(), []


def _intent_loan(nums: List[float]) -> Reply:
    if len(nums) < 2:
        return (
            "Tell me the **total cost** and **expected profit**, e.g. "
            "_\"loan for cost 80000 profit 120000\"_.",
            [],
        )
    try:
        res = loan_calculator(total_cost=nums[0], expected_profit=nums[1])
    except Exception as e:
        return f"Couldn't run calculator: {e}", []
    lines = ["### Loan feasibility\n"]
    if isinstance(res, dict):
        pretty = {
            "loan_amount": "Loan amount",
            "emi_inr": "EMI / month",
            "interest_rate_annual": "Interest rate (%)",
            "tenure_months": "Tenure (months)",
            "total_interest": "Total interest",
            "total_repayment": "Total repayment",
            "feasibility": "Feasibility",
            "dti_ratio": "Debt-to-income",
            "recommendation": "Recommendation",
        }
        for k, lbl in pretty.items():
            if k in res:
                v = res[k]
                if isinstance(v, (int, float)) and "rate" not in k and "ratio" not in k and "month" not in k:
                    v = _fmt_inr(v) if v > 100 else f"{v}"
                lines.append(f"- **{lbl}:** {v}")
    return "\n".join(lines), []


def _intent_msp_vs_market(crop: Dict[str, str], region: Optional[str]) -> Reply:
    if not region:
        return "Which region should I compare MSP vs market in?", []
    try:
        res = msp_vs_market(region, crop["crop_id"])
    except Exception as e:
        return f"Couldn't compare: {e}", []
    lines = [f"### MSP vs Market — {crop['crop_name']} @ {region.replace('_',' · ').title()}\n"]
    if isinstance(res, dict):
        for k in ("msp_inr_per_kg", "current_market_price", "avg_market_price",
                  "difference_inr_per_kg", "difference_percent", "verdict", "recommendation"):
            if k in res:
                v = res[k]
                if isinstance(v, float):
                    v = f"{v:,.2f}"
                lines.append(f"- **{k.replace('_',' ').title()}:** {v}")
    return "\n".join(lines), [f"Best time to sell {crop['crop_id']}", f"Price forecast for {crop['crop_id']}"]


# ---------------------------------------------------------------------------
# Main router
# ---------------------------------------------------------------------------
_SLASH_ALIASES = {
    "/help": "help", "/?": "help",
    "/crops": "list crops", "/regions": "list regions",
    "/recommend": "recommend crops",
    "/msp": "msp",
    "/mandi": "mandi price",
    "/pest": "pest alerts",
    "/irrigate": "irrigation schedule",
    "/calendar": "crop calendar",
    "/scheme": "government schemes",
    "/schemes": "government schemes",
    "/loan": "loan",
    "/sell": "best time to sell",
}


def _build_actions(intent: str, crop: Optional[Dict[str, str]], region: Optional[str],
                   season: Optional[str], nums: List[float]) -> List[Dict[str, str]]:
    """Build deep-link buttons into the dashboard for the given intent."""
    acts: List[Dict[str, str]] = []
    if intent == "recommend":
        budget = nums[0] if nums else 15000
        area = nums[1] if len(nums) > 1 else 3
        acts.append(_action(
            "Open in dashboard →",
            _dashboard_link("recommend", region_id=region, season=season or "kharif",
                            budget_per_acre=budget, area_acres=area),
        ))
    elif intent == "simulate" and crop:
        acts.append(_action("Simulate in dashboard →",
                            _dashboard_link("simulate", region_id=region, crop_id=crop["crop_id"])))
    elif intent == "forecast" and crop:
        acts.append(_action("Open price forecast →",
                            _dashboard_link("forecast", region_id=region, crop_id=crop["crop_id"])))
    elif intent == "rotation":
        acts.append(_action("Plan rotation →", _dashboard_link("rotation", region_id=region)))
    elif intent == "schemes":
        acts.append(_action("View all schemes →", _dashboard_link("schemes")))
    elif intent == "pest" and crop:
        acts.append(_action("See pest dashboard →",
                            _dashboard_link("pests", crop_id=crop["crop_id"])))
    elif intent == "irrigate" and crop:
        acts.append(_action("Open irrigation planner →",
                            _dashboard_link("irrigation", crop_id=crop["crop_id"])))
    return acts


def answer(message: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    context = context or {}
    raw = (message or "").strip()
    if not raw:
        return {"reply": "Ask me anything about the platform or your farm.",
                "suggestions": [], "actions": [], "context": context}

    # Expand slash command at the start to a natural-language phrase.
    if raw.startswith("/"):
        token = raw.split(None, 1)[0].lower()
        rest = raw[len(token):].strip()
        expansion = _SLASH_ALIASES.get(token)
        if expansion:
            raw = f"{expansion} {rest}".strip()

    text = raw.lower()

    def _pack(reply: str, sug: List[str], intent: str = "",
              crop: Optional[Dict[str, str]] = None, region: Optional[str] = None,
              season: Optional[str] = None, nums: Optional[List[float]] = None) -> Dict[str, Any]:
        new_ctx = dict(context)
        if region: new_ctx["region_id"] = region
        if crop:   new_ctx["crop_id"] = crop["crop_id"]
        if season: new_ctx["season"] = season
        actions = _build_actions(intent, crop, region, season, nums or []) if intent else []
        return {"reply": reply, "suggestions": sug, "actions": actions, "context": new_ctx}

    # Greetings
    if any(re.search(rf"\b{g}\b", text) for g in GREETINGS) and len(text.split()) <= 4:
        reply, sug = _intent_greeting()
        return _pack(reply, sug)

    # Help / capabilities
    if re.search(r"\b(help|what can you do|features?|capabilit|about (the )?site|what is this)\b", text):
        reply, sug = _intent_help()
        return _pack(reply, sug)

    # Lists
    if re.search(r"\blist (of )?(all )?crops\b|\bwhich crops\b|\bavailable crops\b", text):
        reply, sug = _intent_list_crops()
        return _pack(reply, sug)
    if re.search(r"\blist (of )?(all )?regions\b|\bwhich regions\b|\bavailable regions\b|\bregions you (have|support)\b", text):
        reply, sug = _intent_list_regions()
        return _pack(reply, sug)

    crop = _find_crop(text)
    region = _find_region(text) or context.get("region_id")
    season = _find_season(text) or context.get("season")
    nums = _find_numbers(text)
    # Fall back to remembered crop when the user asks a short follow-up like "its MSP?"
    if not crop and context.get("crop_id"):
        _cbi = _crop_by_id()
        if context["crop_id"] in _cbi:
            crop = _cbi[context["crop_id"]]

    # MSP vs market
    if crop and re.search(r"msp\s*(vs|versus|compared)\s*(mandi|market)", text):
        reply, sug = _intent_msp_vs_market(crop, region)
        return _pack(reply, sug, "forecast", crop, region, season, nums)

    # Plain MSP
    if re.search(r"\bmsp\b|\bminimum support price\b", text):
        reply, sug = _intent_msp(crop)
        return _pack(reply, sug, crop=crop, region=region)

    # Recommend
    if re.search(r"\brecommend(ation)?\b|\bsuggest(ion)?\b|\bwhich crop\b|\bbest crop\b|\bwhat (should|to) (i )?(grow|plant|sow)\b", text):
        reply, sug = _intent_recommend(region, season, nums)
        return _pack(reply, sug, "recommend", region=region, season=season, nums=nums)

    # Sell timing
    if crop and re.search(r"\bbest time to sell\b|\bwhen (should|to) (i )?sell\b|\bsell(ing)? advice\b", text):
        reply, sug = _intent_sell_advice(crop, region)
        return _pack(reply, sug, "forecast", crop, region)

    # Mandi prices
    if re.search(r"\bmandi\b|\bmarket price\b|\bprice of\b|\bprice in\b|\bprices?\b", text) and (crop or region):
        reply, sug = _intent_mandi_price(crop, region)
        return _pack(reply, sug, "forecast", crop, region)

    # Pest / disease
    if crop and re.search(r"\bpest\b|\bdisease\b|\binsect\b|\bfung", text):
        reply, sug = _intent_pest(crop)
        return _pack(reply, sug, "pest", crop, region)

    # Irrigation
    if crop and re.search(r"\birrigat|\bwater(ing)?\b", text):
        reply, sug = _intent_irrigation(crop)
        return _pack(reply, sug, "irrigate", crop, region)

    # Calendar
    if crop and re.search(r"\bcalendar\b|\bsowing\b|\bsow(ing)? date\b|\bharvest(ing)? date\b", text):
        reply, sug = _intent_calendar(crop)
        return _pack(reply, sug, crop=crop, region=region)

    # Schemes
    if re.search(r"\bscheme|\bsubsidy|\bsubsidies|\bpm[- ]?kisan\b|\bgovernment\b|\bloan waiver\b|\binsurance\b", text):
        reply, sug = _intent_schemes(crop, region, nums)
        return _pack(reply, sug, "schemes", crop, region)

    # Loan
    if re.search(r"\bloan\b|\bemi\b|\binterest\b", text):
        reply, sug = _intent_loan(nums)
        return _pack(reply, sug)

    # Tell me about <crop>
    if crop and re.search(r"\b(tell me about|about|info on|details of|what is)\b", text):
        reply, sug = _intent_about_crop(crop)
        return _pack(reply, sug, "simulate", crop, region)

    # Bare crop name -> crop card
    if crop and len(text.split()) <= 3:
        reply, sug = _intent_about_crop(crop)
        return _pack(reply, sug, "simulate", crop, region)

    # Fallback
    fallback = (
        "I didn't catch that. I'm tuned specifically to **Mitti Mantra**, so "
        "try questions about crops, regions, mandi prices, MSP, recommendations, "
        "irrigation, pests or government schemes.\n\n"
        "Type **help** to see everything I can do, or try slash commands like "
        "`/recommend`, `/msp`, `/mandi`, `/pest`, `/sell`, `/schemes`."
    )
    return _pack(fallback, [
        "Help",
        "Recommend crops for Telangana Medak",
        "MSP of wheat",
        "Pest alerts for rice",
    ])
