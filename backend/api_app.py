"""
CryptoGuard API — Production FastAPI Backend
=============================================
Serves ML pipeline outputs as REST API endpoints.
Frontend is deployed separately on Vercel.

Environment Variables:
    FRONTEND_URL  — Vercel frontend URL for CORS (default: * for dev)
    PORT          — Server port (set by Render, default: 8000)

Run locally:
    uvicorn api_app:app --reload --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import requests as req
import re
import os
import logging

# ── Logging ──
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cryptoguard")

# ── App Setup ──
app = FastAPI(
    title="CryptoGuard API",
    description="Decision Support System for Crypto Market Risk Detection — Real Data from CoinGecko + DeFiLlama",
    version="2.0.0",
)

# ── CORS — Environment-Aware ──
FRONTEND_URL = os.environ.get("FRONTEND_URL", "*")

# Build allowed origins list
allowed_origins = []
if FRONTEND_URL == "*":
    allowed_origins = ["*"]
else:
    # Support comma-separated origins
    allowed_origins = [url.strip() for url in FRONTEND_URL.split(",")]
    # Always allow localhost for dev
    allowed_origins.extend([
        "http://localhost:3000",
        "http://localhost:5500",
        "http://localhost:8080",
        "http://127.0.0.1:5500",
    ])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Data Directory ──
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cryptoguard_data")

# ── CSV Cache (warm up on startup) ──
_csv_cache = {}


def load_csv(filename, index_col=0, parse_dates=True, use_cache=True):
    """Load a CSV file from the data directory, with optional caching."""
    if use_cache and filename in _csv_cache:
        return _csv_cache[filename]

    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Data file not found: {filename}")

    df = pd.read_csv(path, index_col=index_col, parse_dates=parse_dates)

    if use_cache:
        _csv_cache[filename] = df

    return df


@app.on_event("startup")
async def startup_warmup():
    """Pre-load CSV files on startup to reduce cold-start latency."""
    csv_files = [
        "featured_combined.csv",
        "anomaly_signals.csv",
        "regime_signals.csv",
        "advisory_signals.csv",
    ]
    for filename in csv_files:
        try:
            load_csv(filename)
            logger.info(f"  ✓ Loaded {filename}")
        except Exception as e:
            logger.warning(f"  ✗ Could not load {filename}: {e}")

    # Airdrop scores has no index column
    try:
        path = os.path.join(DATA_DIR, "airdrop_scores.csv")
        if os.path.exists(path):
            _csv_cache["airdrop_scores.csv"] = pd.read_csv(path)
            logger.info("  ✓ Loaded airdrop_scores.csv")
    except Exception as e:
        logger.warning(f"  ✗ Could not load airdrop_scores.csv: {e}")

    logger.info("CryptoGuard API ready.")


# ═══════════════════════════════════════════════════════════════
#  API ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.get("/ping")
def ping():
    """Lightweight ping for frontend keep-alive / cold-start wake-up."""
    return {"status": "ok"}


@app.get("/health")
def health():
    """System health check — reports which data files are available."""
    files = [
        "featured_combined.csv", "anomaly_signals.csv",
        "regime_signals.csv", "airdrop_scores.csv",
        "advisory_signals.csv",
    ]
    status = {}
    for f in files:
        path = os.path.join(DATA_DIR, f)
        status[f] = os.path.exists(path)
    all_ok = all(status.values())
    return {"status": "healthy" if all_ok else "degraded", "files": status}


@app.get("/market/latest")
def market_latest():
    """Get latest market data."""
    df = load_csv("featured_combined.csv")
    latest = df.iloc[-1]
    price_cols = [c for c in df.columns if '_price' in c]
    result = {col: float(latest[col]) for col in price_cols if col in latest.index}
    result["date"] = str(df.index[-1])
    return result


@app.get("/market/history")
def market_history(days: int = 30):
    """Get historical market data."""
    df = load_csv("featured_combined.csv")
    df_recent = df.tail(days)
    price_cols = [c for c in df.columns if '_price' in c]
    result = df_recent[price_cols].copy()
    result.index = result.index.astype(str)
    records = []
    for date, row in result.iterrows():
        record = {"date": date}
        for col in price_cols:
            record[col] = float(row[col]) if pd.notna(row[col]) else None
        records.append(record)
    return records


@app.get("/anomaly/latest")
def anomaly_latest():
    """Get latest anomaly signals."""
    df = load_csv("anomaly_signals.csv")
    latest = df.iloc[-1]
    return {
        "date": str(df.index[-1]),
        "anomaly_score": float(latest.get("anomaly_score_smoothed", 0)),
        "anomaly_flag": int(latest.get("anomaly_flag", 0)),
        "cluster_name": str(latest.get("cluster_name", "Unknown")),
        "risk_level": str(latest.get("risk_level", "Unknown")),
    }


@app.get("/anomaly/history")
def anomaly_history(days: int = 30):
    """Get anomaly signal history."""
    df = load_csv("anomaly_signals.csv")
    result = df.tail(days).copy()
    result.index = result.index.astype(str)
    records = []
    for date, row in result.iterrows():
        record = {"date": date}
        for col in result.columns:
            val = row[col]
            if isinstance(val, (int, float)):
                record[col] = float(val) if pd.notna(val) else None
            else:
                record[col] = str(val) if pd.notna(val) else None
        records.append(record)
    return records


@app.get("/regime/latest")
def regime_latest():
    """Get latest regime detection."""
    df = load_csv("regime_signals.csv")
    latest = df.iloc[-1]
    return {
        "date": str(df.index[-1]),
        "hmm_regime": str(latest.get("hmm_regime", "Unknown")),
        "xgb_regime": str(latest.get("xgb_regime", "Unknown")),
        "blended_regime": str(latest.get("blended_regime", "Unknown")),
        "blended_regime_score": float(latest.get("blended_regime_score", 0)),
    }


@app.get("/regime/history")
def regime_history(days: int = 30):
    """Get regime signal history."""
    df = load_csv("regime_signals.csv")
    result = df.tail(days).copy()
    result.index = result.index.astype(str)
    records = []
    for date, row in result.iterrows():
        record = {"date": date}
        for col in result.columns:
            val = row[col]
            if isinstance(val, (int, float)):
                record[col] = float(val) if pd.notna(val) else None
            else:
                record[col] = str(val) if pd.notna(val) else None
        records.append(record)
    return records


@app.get("/airdrop/rankings")
def airdrop_rankings():
    """Get airdrop probability rankings."""
    if "airdrop_scores.csv" in _csv_cache:
        df = _csv_cache["airdrop_scores.csv"]
    else:
        path = os.path.join(DATA_DIR, "airdrop_scores.csv")
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Airdrop scores not found")
        df = pd.read_csv(path)

    records = []
    for _, row in df.sort_values("rank").iterrows():
        record = {}
        for col in df.columns:
            val = row[col]
            if isinstance(val, (int, float)):
                record[col] = float(val) if pd.notna(val) else None
            else:
                record[col] = str(val) if pd.notna(val) else None
        records.append(record)
    return records


@app.get("/advisory/latest")
def advisory_latest():
    """Get latest capital allocation advisory."""
    df = load_csv("advisory_signals.csv")
    latest = df.iloc[-1]
    return {
        "date": str(df.index[-1]),
        "composite_risk_score": float(latest.get("composite_risk_score", 0)),
        "tier": int(latest.get("tier", 0)),
        "tier_name": str(latest.get("tier_name", "")),
        "advisory": str(latest.get("advisory", "")),
        "components": {
            "anomaly": float(latest.get("anomaly_component", 0)),
            "regime": float(latest.get("regime_component", 0)),
            "drawdown": float(latest.get("drawdown_component", 0)),
            "volatility": float(latest.get("volatility_component", 0)),
        }
    }


@app.get("/advisory/history")
def advisory_history(days: int = 30):
    """Get advisory signal history."""
    df = load_csv("advisory_signals.csv")
    result = df.tail(days).copy()
    result.index = result.index.astype(str)
    records = []
    for date, row in result.iterrows():
        record = {"date": date}
        for col in result.columns:
            val = row[col]
            if isinstance(val, (int, float)):
                record[col] = float(val) if pd.notna(val) else None
            else:
                record[col] = str(val) if pd.notna(val) else None
        records.append(record)
    return records


@app.get("/risk/composite")
def risk_composite(days: int = 30):
    """Get composite risk score history."""
    df = load_csv("advisory_signals.csv")
    cols = ["composite_risk_score", "tier", "tier_name"]
    avail = [c for c in cols if c in df.columns]
    result = df[avail].tail(days).copy()
    result.index = result.index.astype(str)
    records = []
    for date, row in result.iterrows():
        record = {"date": date}
        for col in avail:
            val = row[col]
            if isinstance(val, (int, float)):
                record[col] = float(val) if pd.notna(val) else None
            else:
                record[col] = str(val) if pd.notna(val) else None
        records.append(record)
    return records


@app.get("/portfolio/analyze")
def portfolio_analyze(address: str):
    """Analyze a Web3 wallet portfolio using Ethplorer + ML pipeline signals."""
    if not re.match(r"^0x[a-fA-F0-9]{40}$", address):
        raise HTTPException(status_code=400, detail="Invalid Ethereum address")

    # Fetch wallet data from Ethplorer (free tier)
    try:
        resp = req.get(
            f"https://api.ethplorer.io/getAddressInfo/{address}?apiKey=freekey",
            timeout=15,
        )
        resp.raise_for_status()
        wallet = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ethplorer API error: {str(e)}")

    # Parse holdings
    eth_bal = wallet.get("ETH", {}).get("balance", 0)
    eth_price = wallet.get("ETH", {}).get("price", {}).get("rate", 0)
    eth_val = eth_bal * eth_price

    holdings = [{
        "symbol": "ETH", "name": "Ethereum",
        "balance": eth_bal, "price": eth_price, "value": eth_val,
        "change24h": wallet.get("ETH", {}).get("price", {}).get("diff", 0),
    }]

    for t in wallet.get("tokens", []):
        info = t.get("tokenInfo", {})
        decimals = int(info.get("decimals", 18) or 18)
        balance = t.get("balance", 0) / (10 ** decimals)
        price = info.get("price", {}).get("rate", 0) if isinstance(info.get("price"), dict) else 0
        value = balance * price
        if value > 0.01:
            holdings.append({
                "symbol": info.get("symbol", "???"),
                "name": info.get("name", "Unknown"),
                "balance": balance, "price": price, "value": value,
                "change24h": info.get("price", {}).get("diff", 0) if isinstance(info.get("price"), dict) else 0,
            })

    holdings.sort(key=lambda x: x["value"], reverse=True)
    total_value = sum(h["value"] for h in holdings)

    # Load ML pipeline signals
    signals = {}
    try:
        adv_df = load_csv("advisory_signals.csv")
        latest_adv = adv_df.iloc[-1]
        signals["risk_score"] = float(latest_adv.get("composite_risk_score", 0))
        signals["tier"] = int(latest_adv.get("tier", 0))
        signals["tier_name"] = str(latest_adv.get("tier_name", ""))
        signals["advisory"] = str(latest_adv.get("advisory", ""))
    except Exception:
        pass
    try:
        reg_df = load_csv("regime_signals.csv")
        latest_reg = reg_df.iloc[-1]
        signals["regime"] = str(latest_reg.get("blended_regime", "Unknown"))
        signals["regime_score"] = float(latest_reg.get("blended_regime_score", 0))
    except Exception:
        pass
    try:
        anom_df = load_csv("anomaly_signals.csv")
        latest_anom = anom_df.iloc[-1]
        signals["anomaly_score"] = float(latest_anom.get("anomaly_score_smoothed", 0))
        signals["risk_level"] = str(latest_anom.get("risk_level", "Unknown"))
    except Exception:
        pass

    # Generate personalized suggestions
    suggestions = []
    regime = signals.get("regime", "Unknown")
    tier = signals.get("tier", 3)

    if regime == "Bull":
        suggestions.append({"icon": "bull", "type": "positive", "text": "Market is in a Bull regime. Favorable conditions for crypto exposure."})
    elif regime == "Bear":
        suggestions.append({"icon": "bear", "type": "danger", "text": "Market is in a Bear regime. Consider reducing volatile asset exposure."})
    else:
        suggestions.append({"icon": "sideways", "type": "info", "text": "Market is Sideways. Maintain positions with tight risk management."})

    if tier <= 2:
        suggestions.append({"icon": "check", "type": "positive", "text": f"Risk Tier {tier} ({signals.get('tier_name','')}): {signals.get('advisory','')}"})
    elif tier <= 4:
        suggestions.append({"icon": "warn", "type": "warning", "text": f"Risk Tier {tier} ({signals.get('tier_name','')}): {signals.get('advisory','')}"})
    else:
        suggestions.append({"icon": "alert", "type": "danger", "text": f"Risk Tier {tier} ({signals.get('tier_name','')}): {signals.get('advisory','')}"})

    if signals.get("risk_level") == "High":
        suggestions.append({"icon": "alert", "type": "danger", "text": "High anomaly activity detected. Exercise extreme caution."})

    if total_value > 0 and len(holdings) > 0:
        top_pct = (holdings[0]["value"] / total_value) * 100
        if top_pct > 70:
            suggestions.append({"icon": "warn", "type": "warning", "text": f"Portfolio is {top_pct:.0f}% concentrated in {holdings[0]['symbol']}. Consider diversifying."})

    return {
        "address": address,
        "total_value": total_value,
        "holdings": holdings[:50],
        "signals": signals,
        "suggestions": suggestions,
    }


# ═══════════════════════════════════════════════════════════════
#  ROOT — API info (no website served from backend)
# ═══════════════════════════════════════════════════════════════

@app.get("/")
def root():
    """API root — returns service info."""
    return {
        "service": "CryptoGuard API v2",
        "data_source": "Real data from CoinGecko + DeFiLlama",
        "docs": "/docs",
        "health": "/health",
        "frontend": FRONTEND_URL,
    }


# ═══════════════════════════════════════════════════════════════
#  LOCAL DEV SERVER
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print("\n" + "=" * 50)
    print("  CryptoGuard API — Starting Server")
    print(f"  API:   http://localhost:{port}")
    print(f"  Docs:  http://localhost:{port}/docs")
    print("=" * 50 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
