// ═══ API CONFIGURATION ═══
// Reads from config.js (loaded before this file), falls back to localhost for dev
const API_BASE = (window.__CRYPTOGUARD_API__ || 'http://localhost:8000').replace(/\/+$/, '');
const ETHPLORER_API = 'https://api.ethplorer.io';
const COLORS = { green:'#2dd4a8', teal:'#14b8a6', purple:'#8b5cf6', orange:'#f59e0b', red:'#ef4444', blue:'#3b82f6', cyan:'#06b6d4', gray:'#5a6478' };
const CHART_THEME = {
    responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{ legend:{labels:{color:'#8a94a6',font:{family:'Inter',size:12}}}, tooltip:{backgroundColor:'rgba(20,24,32,0.95)',titleColor:'#e8ecf1',bodyColor:'#8a94a6',borderColor:'#1e2430',borderWidth:1,cornerRadius:8,padding:12} },
    scales:{ x:{ticks:{color:'#5a6478',font:{family:'Inter',size:11},maxTicksLimit:10},grid:{color:'rgba(255,255,255,0.03)'}}, y:{ticks:{color:'#5a6478',font:{family:'Inter',size:11}},grid:{color:'rgba(255,255,255,0.03)'}} }
};
let charts = {};
let _serverAwake = false;

// ═══ NAVIGATION ═══
function navigateTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${pageId}`)?.classList.add('active');
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-page="${pageId}"]`)?.classList.add('active');
    const titles = {dashboard:'Dashboard',portfolio:'Portfolio',airdrops:'Airdrops',strategy:'Strategy',education:'Education'};
    document.getElementById('nav-title').textContent = titles[pageId]||'Dashboard';
    if (pageId==='portfolio') loadPortfolioPage();
    if (pageId==='airdrops') loadAirdropsPage();
    if (pageId==='strategy') loadStrategyPage();
}

function initNavigation() {
    document.querySelectorAll('.nav-tab').forEach(t => t.addEventListener('click', e => { e.preventDefault(); navigateTo(t.dataset.page); }));
    document.getElementById('nav-back')?.addEventListener('click', () => navigateTo('dashboard'));
    document.getElementById('btn-analyze-risk')?.addEventListener('click', () => navigateTo('strategy'));
    document.getElementById('btn-browse-airdrops')?.addEventListener('click', () => navigateTo('airdrops'));
    document.getElementById('btn-get-strategy')?.addEventListener('click', () => navigateTo('strategy'));
    document.getElementById('btn-learn-more')?.addEventListener('click', () => navigateTo('education'));
    document.getElementById('link-view-all')?.addEventListener('click', e => { e.preventDefault(); navigateTo('airdrops'); });

    // Dashboard mini wallet input
    document.getElementById('btn-analyze-wallet')?.addEventListener('click', () => {
        const addr = document.getElementById('wallet-address-mini')?.value?.trim();
        if (addr) { document.getElementById('wallet-address-full').value = addr; }
        navigateTo('portfolio');
        if (addr && isValidAddress(addr)) analyzeWallet(addr);
    });
    document.getElementById('wallet-address-mini')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('btn-analyze-wallet')?.click();
    });

    // Portfolio page wallet input
    document.getElementById('btn-wallet-analyze')?.addEventListener('click', () => {
        const addr = document.getElementById('wallet-address-full')?.value?.trim();
        if (addr) analyzeWallet(addr);
    });
    document.getElementById('wallet-address-full')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('btn-wallet-analyze')?.click();
    });

    // Disconnect
    document.getElementById('btn-disconnect')?.addEventListener('click', () => {
        document.getElementById('portfolio-results')?.classList.add('hidden');
        document.getElementById('wallet-section')?.classList.remove('hidden');
        document.getElementById('wallet-address-full').value = '';
    });

    // Chart time chips
    document.querySelectorAll('.chip[data-target]').forEach(chip => {
        chip.addEventListener('click', () => {
            chip.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const days = parseInt(chip.dataset.days);
            if (chip.dataset.target==='prices') loadPriceChart(days);
            if (chip.dataset.target==='risk') loadRiskChart(days);
        });
    });

    // Airdrop search
    document.getElementById('full-airdrop-search')?.addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('#full-airdrop-tbody tr').forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q)?'':'none'; });
    });
}

function isValidAddress(addr) { return /^0x[a-fA-F0-9]{40}$/.test(addr); }

// ═══ API HELPERS (with cold-start retry) ═══
function showConnectionStatus(msg, type) {
    let el = document.getElementById('connection-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'connection-status ' + (type || '');
    el.style.display = msg ? 'inline-block' : 'none';
}

async function api(endpoint, retries = 3) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            if (!_serverAwake && attempt === 0) {
                showConnectionStatus('Connecting to server...', 'connecting');
            }
            const r = await fetch(`${API_BASE}${endpoint}`, { signal: AbortSignal.timeout(45000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            if (!_serverAwake) { _serverAwake = true; showConnectionStatus('', ''); }
            return data;
        } catch(e) {
            if (attempt < retries) {
                const delay = Math.min(2000 * Math.pow(2, attempt), 10000);
                showConnectionStatus(`Server waking up... retry ${attempt + 1}/${retries}`, 'connecting');
                await new Promise(r => setTimeout(r, delay));
            } else {
                showConnectionStatus('Server unavailable', 'error');
                return null;
            }
        }
    }
    return null;
}

async function wakeUpServer() {
    try {
        await fetch(`${API_BASE}/ping`, { signal: AbortSignal.timeout(60000) });
        _serverAwake = true;
        showConnectionStatus('', '');
    } catch(e) {
        showConnectionStatus('Server starting...', 'connecting');
    }
}

// ═══ WALLET ANALYSIS ═══
async function analyzeWallet(address) {
    if (!isValidAddress(address)) {
        showWalletError('Invalid Ethereum address. Please enter a valid 0x... address.');
        return;
    }
    hideWalletError();
    const btn = document.getElementById('btn-wallet-analyze');
    const spinner = document.getElementById('wallet-spinner');
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');

    try {
        // Fetch wallet data from Ethplorer (free, no key needed)
        const walletData = await fetchWalletData(address);
        // Fetch ML pipeline signals
        const [advisory, regime, anomaly] = await Promise.all([api('/advisory/latest'), api('/regime/latest'), api('/anomaly/latest')]);

        // Show results
        document.getElementById('wallet-section')?.classList.add('hidden');
        document.getElementById('portfolio-results')?.classList.remove('hidden');

        // Wallet badge
        setText('wallet-display-addr', `${address.slice(0,6)}...${address.slice(-4)}`);

        // Render portfolio data
        renderPortfolioData(walletData, advisory, regime, anomaly);
    } catch(e) {
        showWalletError(`Failed to analyze wallet: ${e.message}. Please try again.`);
    } finally {
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
    }
}

async function fetchWalletData(address) {
    const url = `${ETHPLORER_API}/getAddressInfo/${address}?apiKey=freekey`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Ethplorer API error');
    return await res.json();
}

function renderPortfolioData(wallet, advisory, regime, anomaly) {
    const ethBalance = wallet.ETH?.balance || 0;
    const ethPrice = wallet.ETH?.price?.rate || 0;
    const ethValue = ethBalance * ethPrice;
    const tokens = wallet.tokens || [];

    // Build holdings array
    let holdings = [{ symbol:'ETH', name:'Ethereum', balance:ethBalance, price:ethPrice, value:ethValue, change24h: wallet.ETH?.price?.diff || 0 }];
    tokens.forEach(t => {
        const info = t.tokenInfo || {};
        const decimals = parseInt(info.decimals || 18);
        const balance = t.balance / Math.pow(10, decimals);
        const price = info.price?.rate || 0;
        const value = balance * price;
        if (value > 0.01) {
            holdings.push({ symbol: info.symbol||'???', name: info.name||'Unknown', balance, price, value, change24h: info.price?.diff || 0 });
        }
    });
    holdings.sort((a,b) => b.value - a.value);
    const totalValue = holdings.reduce((s,h) => s + h.value, 0);

    // KPIs
    setText('p-total-value', `$${formatUSD(totalValue)}`);
    setText('p-token-count', `${holdings.length} token${holdings.length!==1?'s':''}`);
    setText('p-eth-balance', `${ethBalance.toFixed(4)} ETH`);
    setText('p-eth-value', `$${formatUSD(ethValue)} USD`);

    // Risk assessment from ML
    if (advisory) {
        const score = advisory.composite_risk_score;
        const el = document.getElementById('p-risk-assessment');
        if (el) {
            el.textContent = score < 30 ? 'Low Risk' : score < 60 ? 'Moderate' : 'High Risk';
            el.style.color = score < 30 ? COLORS.green : score < 60 ? COLORS.orange : COLORS.red;
        }
        setText('p-risk-detail', `Score: ${score?.toFixed(1)}/100 • Tier ${advisory.tier}`);
    }

    // Market scenario
    if (regime) {
        const el = document.getElementById('scn-regime');
        if (el) { el.textContent = regime.blended_regime||'—'; el.style.color = regime.blended_regime==='Bull'?COLORS.green:regime.blended_regime==='Bear'?COLORS.red:COLORS.cyan; }
    }
    if (advisory) { const el = document.getElementById('scn-risk'); if (el) { el.textContent = advisory.composite_risk_score?.toFixed(1)||'—'; el.style.color = advisory.composite_risk_score<40?COLORS.green:advisory.composite_risk_score<70?COLORS.orange:COLORS.red; } }
    if (anomaly) { const el = document.getElementById('scn-anomaly'); if (el) { el.textContent = anomaly.risk_level||'—'; el.style.color = anomaly.risk_level==='High'?COLORS.red:anomaly.risk_level==='Medium'?COLORS.orange:COLORS.green; } }
    if (advisory) { setText('scn-tier', `Tier ${advisory.tier}`); }

    // Suggestions
    generateSuggestions(holdings, totalValue, advisory, regime, anomaly);

    // Holdings table
    renderHoldingsTable(holdings, totalValue);

    // Allocation chart
    renderAllocationChart(holdings, totalValue);

    // Price chart
    loadPriceChart(30);
}

function generateSuggestions(holdings, totalValue, advisory, regime, anomaly) {
    const list = document.getElementById('suggestions-list');
    if (!list) return;
    list.innerHTML = '';
    const suggestions = [];

    // Regime-based suggestions
    const regimeName = regime?.blended_regime || 'Unknown';
    if (regimeName === 'Bull') {
        suggestions.push({ icon:'📈', text:'The market is in a <strong>Bull regime</strong>. Conditions are favorable for maintaining or increasing crypto exposure. Consider taking partial profits on large gains.', type:'' });
    } else if (regimeName === 'Bear') {
        suggestions.push({ icon:'📉', text:'The market is in a <strong>Bear regime</strong>. Consider reducing exposure to volatile assets and moving to stablecoins or hedged positions.', type:'danger' });
    } else {
        suggestions.push({ icon:'📊', text:'The market is in a <strong>Sideways regime</strong>. Range-bound conditions suggest maintaining current positions with tight stop-losses.', type:'info' });
    }

    // Risk-based suggestions
    if (advisory) {
        const tier = advisory.tier;
        if (tier <= 2) suggestions.push({ icon:'✅', text:`Risk Tier ${tier}: <strong>${advisory.tier_name}</strong>. ${advisory.advisory}`, type:'' });
        else if (tier <= 4) suggestions.push({ icon:'⚠️', text:`Risk Tier ${tier}: <strong>${advisory.tier_name}</strong>. ${advisory.advisory}`, type:'warn' });
        else suggestions.push({ icon:'🚨', text:`Risk Tier ${tier}: <strong>${advisory.tier_name}</strong>. ${advisory.advisory}`, type:'danger' });
    }

    // Anomaly-based
    if (anomaly?.risk_level === 'High') {
        suggestions.push({ icon:'🔴', text:'<strong>High anomaly activity detected.</strong> The market is exhibiting unusual patterns. Exercise extreme caution with new positions.', type:'danger' });
    }

    // Portfolio concentration
    if (holdings.length > 0 && totalValue > 0) {
        const topPct = (holdings[0].value / totalValue) * 100;
        if (topPct > 70) {
            suggestions.push({ icon:'⚖️', text:`Your portfolio is <strong>${topPct.toFixed(0)}% concentrated</strong> in ${holdings[0].symbol}. Consider diversifying across multiple assets to reduce single-token risk.`, type:'warn' });
        }
        // ETH dominance
        const ethHolding = holdings.find(h => h.symbol === 'ETH');
        if (ethHolding && totalValue > 0) {
            const ethPct = (ethHolding.value / totalValue) * 100;
            if (ethPct < 20 && totalValue > 100) {
                suggestions.push({ icon:'💎', text:`Your ETH allocation is only <strong>${ethPct.toFixed(0)}%</strong>. Consider holding more ETH as a base-layer asset for gas fees and as a less volatile crypto holding.`, type:'info' });
            }
        }
    }

    if (totalValue < 100 && totalValue > 0) {
        suggestions.push({ icon:'💰', text:'Your portfolio value is relatively small. Be mindful of gas fees relative to transaction values on Ethereum mainnet.', type:'info' });
    }

    suggestions.forEach(s => {
        const div = document.createElement('div');
        div.className = `suggestion-item ${s.type}`;
        div.innerHTML = `<span class="suggestion-icon">${s.icon}</span><span>${s.text}</span>`;
        list.appendChild(div);
    });
}

function renderHoldingsTable(holdings, totalValue) {
    const tbody = document.getElementById('holdings-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (holdings.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No tokens found</td></tr>'; return; }

    holdings.forEach(h => {
        const pct = totalValue > 0 ? (h.value / totalValue * 100) : 0;
        const chgColor = h.change24h >= 0 ? COLORS.green : COLORS.red;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="project-name">${h.symbol}</span><span class="project-status">${h.name}</span></td>
            <td style="font-family:var(--font-mono);">${h.balance < 0.0001 ? h.balance.toExponential(2) : h.balance.toFixed(4)}</td>
            <td style="font-family:var(--font-mono);">$${h.price < 0.01 ? h.price.toFixed(6) : h.price.toFixed(2)}</td>
            <td style="font-family:var(--font-mono); font-weight:600;">$${formatUSD(h.value)}</td>
            <td style="font-family:var(--font-mono);">${pct.toFixed(1)}%</td>
            <td style="font-family:var(--font-mono); color:${chgColor};">${h.change24h >= 0 ? '+' : ''}${h.change24h.toFixed(2)}%</td>`;
        tbody.appendChild(tr);
    });
}

function renderAllocationChart(holdings, totalValue) {
    const top = holdings.slice(0, 8);
    const otherValue = holdings.slice(8).reduce((s,h) => s + h.value, 0);
    const labels = top.map(h => h.symbol);
    const data = top.map(h => h.value);
    if (otherValue > 0) { labels.push('Other'); data.push(otherValue); }
    const palette = [COLORS.blue, COLORS.green, COLORS.purple, COLORS.orange, COLORS.cyan, COLORS.red, COLORS.teal, '#ec4899', COLORS.gray];
    renderDoughnut('chart-portfolio-alloc', { labels, data, colors: palette.slice(0, labels.length) });
}

function showWalletError(msg) { const el = document.getElementById('wallet-error'); if (el) { el.textContent = msg; el.classList.remove('hidden'); } }
function hideWalletError() { document.getElementById('wallet-error')?.classList.add('hidden'); }

// ═══ DASHBOARD ═══
async function loadDashboard() {
    const [advisory, regime, anomaly, airdrops] = await Promise.all([api('/advisory/latest'), api('/regime/latest'), api('/anomaly/latest'), api('/airdrop/rankings')]);
    if (advisory && anomaly) {
        setText('stress-value', (advisory.composite_risk_score / 10).toFixed(1));
        const icon = document.getElementById('stress-icon');
        if (icon) icon.textContent = advisory.composite_risk_score < 40 ? '📈' : advisory.composite_risk_score < 70 ? '📊' : '📉';
    }
    if (regime) {
        const rl = document.getElementById('regime-label');
        if (rl) { rl.textContent = (regime.blended_regime||'—').toUpperCase(); rl.style.color = regime.blended_regime==='Bull'?COLORS.green:regime.blended_regime==='Bear'?COLORS.red:COLORS.orange; }
    }
    const hist = await api('/market/history?days=2');
    if (hist && hist.length >= 2) {
        const prev = hist[hist.length-2], curr = hist[hist.length-1];
        if (prev.bitcoin_price && curr.bitcoin_price) { const c = ((curr.bitcoin_price-prev.bitcoin_price)/prev.bitcoin_price*100).toFixed(2); setText('btc-24h',`${c>=0?'+':''}${c}%`); colorize('btc-24h',c); }
        if (prev.ethereum_price && curr.ethereum_price) { const c = ((curr.ethereum_price-prev.ethereum_price)/prev.ethereum_price*100).toFixed(2); setText('eth-24h',`${c>=0?'+':''}${c}%`); colorize('eth-24h',c); }
    }
    if (advisory) {
        const s = advisory.composite_risk_score; let h,hc;
        if (s<30){h='Good';hc=COLORS.green;} else if(s<60){h='Fair';hc=COLORS.orange;} else{h='At Risk';hc=COLORS.red;}
        const hv = document.getElementById('health-value'); if(hv){hv.textContent=h;hv.style.color=hc;}
    }
    if (airdrops && airdrops.length > 0) renderDashboardAirdropTable(airdrops.slice(0,6));
}

function renderDashboardAirdropTable(data) {
    const tbody = document.getElementById('airdrop-tbody'); if (!tbody) return; tbody.innerHTML = '';
    const chainMap = { 'aave':'Ethereum L1','lido':'Ethereum L1','uniswap':'Ethereum L1','compound':'Ethereum L1','arbitrum':'Ethereum L2','optimism':'Ethereum L2','gmx':'Arbitrum','jupiter':'Solana','jito':'Solana' };
    data.forEach(p => {
        const name=p.protocol||'—', prob=p.ensemble_probability||0, score=Math.round(prob*100), chain=chainMap[name]||'Multi-chain', status=p.airdrop_conducted?'confirmed':'upcoming';
        const sc = score>=80?'score-high':score>=50?'score-mid':'score-low';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><span class="project-name">${capitalize(name)}</span><span class="project-status">${status}</span></td><td style="color:var(--text-secondary)">${chain}</td><td style="color:var(--text-secondary)">—</td><td class="score-cell ${sc}">${score}</td><td class="likelihood-cell">${Math.round(prob*95)}%</td><td class="risk-cell">${Math.round((1-prob)*40+10)}%</td>`;
        tbody.appendChild(tr);
    });
}

// ═══ PORTFOLIO PAGE ═══
let portfolioLoaded = false;
async function loadPortfolioPage() { /* wallet input page loads on demand */ }
async function loadPriceChart(days) {
    const data = await api(`/market/history?days=${days}`); if (!data || !data.length) return;
    const labels = data.map(d => fmtDate(d.date));
    const keys = Object.keys(data[0]).filter(k => k.endsWith('_price'));
    const pal = [COLORS.orange,COLORS.blue,COLORS.cyan,COLORS.green,COLORS.purple];
    const ds = keys.map((k,i) => ({ label:capitalize(k.replace('_price','')), data:data.map(d=>d[k]), borderColor:pal[i%pal.length], backgroundColor:'transparent', borderWidth:2, pointRadius:0, tension:0.3, yAxisID:i===0?'y':'y1' }));
    renderLine('chart-prices', labels, ds, true);
}

// ═══ AIRDROPS PAGE ═══
let airdropsLoaded = false;
async function loadAirdropsPage() {
    if (airdropsLoaded) return; airdropsLoaded = true;
    const data = await api('/airdrop/rankings'); if (!data || !data.length) return;
    const tbody = document.getElementById('full-airdrop-tbody'); if (!tbody) return; tbody.innerHTML = '';
    data.forEach(p => {
        const prob = p.ensemble_probability||0, pct = (prob*100).toFixed(1), bc = prob>0.6?COLORS.green:prob>0.3?COLORS.orange:COLORS.red;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="font-family:var(--font-mono);font-weight:600">${p.rank||'—'}</td><td style="font-weight:600">${capitalize(p.protocol||'—')}</td><td><div style="display:flex;align-items:center;gap:10px"><span style="font-family:var(--font-mono);min-width:50px">${pct}%</span><div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:100px;overflow:hidden;min-width:80px"><div style="width:${pct}%;height:100%;background:${bc};border-radius:100px"></div></div></div></td><td style="font-family:var(--font-mono)">${(p.lr_probability||0).toFixed(3)}</td><td style="font-family:var(--font-mono)">${(p.xgb_probability||0).toFixed(3)}</td><td><span class="badge ${p.airdrop_conducted?'badge-yes':'badge-no'}">${p.airdrop_conducted?'✓ Confirmed':'✗ Pending'}</span></td>`;
        tbody.appendChild(tr);
    });
    const top15 = data.slice(0,15);
    renderBar('chart-airdrop-full', { labels:top15.map(d=>capitalize(d.protocol)), values:top15.map(d=>(d.ensemble_probability||0)*100), colors:top15.map(d=>d.airdrop_conducted?COLORS.green:COLORS.teal) });
}

// ═══ STRATEGY PAGE ═══
let strategyLoaded = false;
async function loadStrategyPage() {
    if (strategyLoaded) return; strategyLoaded = true;
    const [adv,regime] = await Promise.all([api('/advisory/latest'),api('/regime/latest')]);
    if (adv) {
        setText('s-risk-score', adv.composite_risk_score?.toFixed(1)||'—'); setText('s-tier',`Tier ${adv.tier}`); setText('s-tier-name',adv.tier_name||''); setText('s-advisory-title',adv.tier_name||'—'); setText('s-advisory-text',adv.advisory||'');
        const bar = document.getElementById('s-risk-bar'); if(bar) bar.style.width=`${adv.composite_risk_score||0}%`;
        if(adv.components) renderDoughnut('chart-components',{labels:['Anomaly (40%)','Regime (35%)','Drawdown (15%)','Volatility (10%)'],data:[adv.components.anomaly,adv.components.regime,adv.components.drawdown,adv.components.volatility],colors:[COLORS.red,COLORS.blue,COLORS.orange,COLORS.purple]});
    }
    if (regime) { const el=document.getElementById('s-regime'); if(el){el.textContent=regime.blended_regime||'—';el.style.color=regime.blended_regime==='Bull'?COLORS.green:regime.blended_regime==='Bear'?COLORS.red:COLORS.cyan;} setText('s-regime-score',`Score: ${regime.blended_regime_score?.toFixed(3)||'—'}`); }
    await loadRiskChart(30);
    const rh = await api('/regime/history?days=90');
    if (rh && rh.length) renderLine('chart-regime', rh.map(d=>fmtDate(d.date)), [{label:'Blended Regime Score',data:rh.map(d=>d.blended_regime_score),borderColor:COLORS.cyan,backgroundColor:hexAlpha(COLORS.cyan,0.08),borderWidth:2,pointRadius:0,tension:0.3,fill:true}]);
}
async function loadRiskChart(days) {
    const data = await api(`/advisory/history?days=${days}`); if (!data || !data.length) return;
    renderLine('chart-risk', data.map(d=>fmtDate(d.date)), [{label:'Composite Risk Score',data:data.map(d=>d.composite_risk_score),borderColor:COLORS.red,backgroundColor:hexAlpha(COLORS.red,0.08),borderWidth:2,pointRadius:0,tension:0.3,fill:true}]);
}

// ═══ CHART RENDERERS ═══
function renderLine(id,labels,datasets,dual=false) {
    const c=document.getElementById(id); if(!c) return; if(charts[id]) charts[id].destroy();
    const opts=JSON.parse(JSON.stringify(CHART_THEME));
    if(dual&&datasets.length>1) opts.scales.y1={...opts.scales.y,position:'right',grid:{drawOnChartArea:false}};
    charts[id]=new Chart(c,{type:'line',data:{labels,datasets},options:opts});
}
function renderDoughnut(id,{labels,data,colors}) {
    const c=document.getElementById(id); if(!c) return; if(charts[id]) charts[id].destroy();
    charts[id]=new Chart(c,{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors,borderColor:'#141820',borderWidth:3,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{position:'bottom',labels:{color:'#8a94a6',font:{family:'Inter',size:11},padding:14,usePointStyle:true}},tooltip:CHART_THEME.plugins.tooltip}}});
}
function renderBar(id,{labels,values,colors}) {
    const c=document.getElementById(id); if(!c) return; if(charts[id]) charts[id].destroy();
    charts[id]=new Chart(c,{type:'bar',data:{labels,datasets:[{label:'Probability (%)',data:values,backgroundColor:colors.map(c=>hexAlpha(c,0.7)),borderColor:colors,borderWidth:1,borderRadius:4}]},options:{...CHART_THEME,indexAxis:'y',plugins:{...CHART_THEME.plugins,legend:{display:false}},scales:{x:{...CHART_THEME.scales.x,max:100},y:{...CHART_THEME.scales.y,ticks:{font:{size:11}}}}}});
}

// ═══ UTILITIES ═══
function setText(id,text) { const el=document.getElementById(id); if(el) el.textContent=text; }
function colorize(id,val) { const el=document.getElementById(id); if(el) el.style.color=parseFloat(val)>=0?COLORS.green:COLORS.red; }
function capitalize(s) { if(!s) return ''; return s.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' '); }
function fmtDate(d) { if(!d) return ''; return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function formatUSD(n) { if(n>=1e6) return (n/1e6).toFixed(2)+'M'; if(n>=1e3) return n.toLocaleString('en-US',{maximumFractionDigits:2}); return n.toFixed(2); }
function hexAlpha(hex,a) { return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`; }

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    await wakeUpServer();
    loadDashboard();
});
