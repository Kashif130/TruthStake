import * as core from './core.js';

core.init();
core.setCheckPageImpl(routePage);

document.addEventListener('DOMContentLoaded', routePage);

function routePage() {
  const path = window.location.pathname;
  if (path === '/' || path.endsWith('/index.html')) initFeedPage();
  else if (path.startsWith('/submit')) initSubmitPage();
  else if (path.startsWith('/claim')) initClaimPage();
}

const STATUS_LABEL = {
  pending: 'Pending',
  true: 'Verified True',
  false: 'Verified False',
  misleading: 'Misleading',
  unverifiable: 'Unverifiable',
};

function stampClass(status) {
  return `stamp stamp--${status || 'pending'}`;
}

// ---------------------------------------------------------------------
// FEED PAGE
// ---------------------------------------------------------------------
let activeFilter = 'all';

async function initFeedPage() {
  if (!core.isConnected()) return;
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.remove('is-active'));
    t.classList.add('is-active');
    activeFilter = t.dataset.status;
    loadFeed();
  }));
  await loadFeed();
}

async function loadFeed() {
  const cardsEl = document.getElementById('sectionCards');
  if (!cardsEl) return;
  cardsEl.innerHTML = '<p class="form-hint">Loading case feed…</p>';
  try {
    const registry = await core.fetchRegistryAddress();
    const fnName = activeFilter === 'all' ? 'get_claims' : 'get_claims_by_status';
    const args = activeFilter === 'all' ? [50] : [activeFilter, 50];
    const raw = await core.readClaim(registry, fnName, args);
    const claims = JSON.parse(raw);
    renderFeed(claims);
    updateStats(claims);
  } catch (e) {
    cardsEl.innerHTML = `<div class="empty-state"><div class="empty-state__title">Could not load cases</div><p>${escapeHtml(e.message || String(e))}</p></div>`;
  }
}

function renderFeed(claims) {
  const cardsEl = document.getElementById('sectionCards');
  if (!claims.length) {
    cardsEl.innerHTML = `<div class="empty-state"><div class="empty-state__title">No cases on file yet</div><p>Be the first to file a claim.</p></div>`;
    return;
  }
  cardsEl.innerHTML = claims.map((c, i) => `
    <a class="case" href="/claim?address=${encodeURIComponent(c.contract)}">
      <span class="case__id">TS-${String(claims.length - i).padStart(4, '0')}</span>
      <p class="case__claim">${escapeHtml(c.claim_text)}</p>
      <span class="${stampClass(c.status)}">${STATUS_LABEL[c.status] || c.status}</span>
      <div class="case__meta">
        <span class="case__pool">${core.toGenDisplay(c.stake)} GEN staked</span>
        <span>${escapeHtml(c.created_at ? new Date(Number(c.created_at)).toLocaleDateString() : '')}</span>
      </div>
    </a>
  `).join('');
}

function updateStats(claims) {
  const openEl = document.getElementById('statOpen');
  const poolEl = document.getElementById('statPool');
  if (openEl) openEl.textContent = claims.filter((c) => c.status === 'pending').length;
  if (poolEl) {
    const totalWei = claims.reduce((sum, c) => sum + BigInt(c.stake || '0'), 0n);
    poolEl.textContent = core.toGenDisplay(totalWei.toString());
  }
}

// ---------------------------------------------------------------------
// SUBMIT PAGE
// ---------------------------------------------------------------------
function initSubmitPage() {
  if (!core.isConnected()) return;
  const form = document.getElementById('claimForm');
  if (!form) return;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const status = document.getElementById('statusMsg');
    const btn = document.getElementById('submitBtn');
    const claimText = document.getElementById('c-text').value.trim();
    const sources = document.getElementById('c-sources').value.trim();
    if (!claimText) return;

    btn.disabled = true;
    status.textContent = 'Deploying claim contract on GenLayer Bradbury… this can take up to a minute.';
    try {
      const submitter = await core.ensureConnected();
      const res = await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submitter, claimText, sources, network: 'bradbury' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Deployment failed');
      status.textContent = `Deployed. Redirecting to the case file to fund your stake…`;
      window.location.href = `/claim?address=${encodeURIComponent(data.contract)}`;
    } catch (e) {
      status.textContent = e.message || String(e);
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------
// CLAIM DETAIL PAGE
// ---------------------------------------------------------------------
function getClaimAddressFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('address');
}

async function initClaimPage() {
  const address = getClaimAddressFromUrl();
  const addrEl = document.getElementById('contractAddr');
  if (addrEl) addrEl.textContent = address || 'unknown';
  const idEl = document.getElementById('caseId');
  if (idEl && address) idEl.textContent = address.slice(0, 10) + '…';

  if (!address) {
    document.getElementById('claimText').textContent = 'Missing contract address in URL.';
    return;
  }

  wireClaimActions(address);
  if (!core.isConnected()) return;
  await loadClaimDetails(address);
}

async function loadClaimDetails(address) {
  const status = document.getElementById('statusMsg');
  try {
    const raw = await core.readClaim(address, 'get_claim_details', []);
    const d = JSON.parse(raw);
    renderClaimDetails(d);
  } catch (e) {
    status.textContent = 'Could not read case file: ' + (e.message || String(e));
  }
}

function renderClaimDetails(d) {
  document.getElementById('claimText').textContent = d.claim_text;
  const stamp = document.getElementById('verdictStamp');
  stamp.className = `stamp stamp--lg ${stampClass(d.status).split(' ')[1]}`;
  stamp.textContent = STATUS_LABEL[d.status] || d.status;

  document.getElementById('fStake').textContent = `${core.toGenDisplay(d.stake)} GEN`;
  document.getElementById('fBacked').textContent = `${core.toGenDisplay(d.total_backed)} GEN`;
  document.getElementById('fReward').textContent = `${core.toGenDisplay(d.reward_pool)} GEN`;
  document.getElementById('fConfidence').textContent = d.confidence !== '0' ? `${d.confidence}%` : '—';
  document.getElementById('fChallenges').textContent = `${d.challenge_count} / 2`;

  if (d.verdict_reasoning) {
    document.getElementById('reasoningBox').style.display = 'block';
    document.getElementById('fReasoning').textContent = d.verdict_reasoning;
  }

  const resolved = d.resolved === 'True' || d.resolved === 'true';
  const challengeActive = d.challenge_active === 'True' || d.challenge_active === 'true';

  document.getElementById('btnFund').style.display = d.stake === '0' ? 'inline-block' : 'none';
  document.getElementById('btnVerify').style.display = (d.stake !== '0' && !resolved) ? 'inline-block' : 'none';
  document.getElementById('btnBack').style.display = (d.stake !== '0' && !resolved) ? 'inline-block' : 'none';
  document.getElementById('btnChallenge').style.display = (resolved && !challengeActive) ? 'inline-block' : 'none';
  document.getElementById('btnPayout').style.display = resolved ? 'inline-block' : 'none';
}

function wireClaimActions(address) {
  const status = document.getElementById('statusMsg');
  const run = async (fn) => {
    try {
      await core.ensureConnected();
      status.textContent = 'Submitting transaction… waiting for validator consensus, this can take a while for AI verification.';
      await fn();
      status.textContent = 'Done.';
      await loadClaimDetails(address);
    } catch (e) {
      status.textContent = e.message || String(e);
    }
  };

  document.getElementById('btnFund').addEventListener('click', () => run(async () => {
    const amount = prompt('Stake amount in GEN:');
    if (!amount) throw new Error('Cancelled');
    await core.writeClaim(address, 'fund_stake', [], core.toGenWei(amount));
  }));

  document.getElementById('btnBack').addEventListener('click', () => run(async () => {
    const amount = prompt('Backing amount in GEN:');
    if (!amount) throw new Error('Cancelled');
    await core.writeClaim(address, 'back_claim', [], core.toGenWei(amount));
  }));

  document.getElementById('btnVerify').addEventListener('click', () => run(async () => {
    await core.writeClaim(address, 'verify_claim', []);
  }));

  document.getElementById('btnChallenge').addEventListener('click', () => run(async () => {
    const amount = prompt('Challenge stake in GEN (must be ≥ original stake):');
    if (!amount) throw new Error('Cancelled');
    await core.writeClaim(address, 'challenge_verdict', [], core.toGenWei(amount));
  }));

  document.getElementById('btnPayout').addEventListener('click', () => run(async () => {
    await core.writeClaim(address, 'claim_payout', []);
  }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
