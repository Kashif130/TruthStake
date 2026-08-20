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
let _feedWired = false;

async function initFeedPage() {
  if (!core.isConnected()) return;
  if (!_feedWired) {
    _feedWired = true;
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach((t) => t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('is-active'));
      t.classList.add('is-active');
      activeFilter = t.dataset.status;
      loadFeed();
    }));
  }
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
  if (!form || form.dataset.wired === 'true') return;
  form.dataset.wired = 'true';
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

  wireClaimActionsOnce(address);
  if (!core.isConnected()) return;
  await loadClaimDetails(address);
}

async function loadClaimDetails(address, retriesLeft = 3) {
  const status = document.getElementById('statusMsg');
  try {
    const raw = await core.readClaim(address, 'get_claim_details', []);
    const d = JSON.parse(raw);
    renderClaimDetails(d);
    return true;
  } catch (e) {
    if (retriesLeft > 0) {
      // The RPC may need a moment to reflect state right after a write; retry a few times before giving up.
      await new Promise((r) => setTimeout(r, 3000));
      return loadClaimDetails(address, retriesLeft - 1);
    }
    status.textContent = 'Could not read case file: ' + (e.message || String(e));
    return false;
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

function promptAmount(label) {
  return new Promise((resolve) => {
    const modal = document.getElementById('amountModal');
    const labelEl = document.getElementById('amountLabel');
    const input = document.getElementById('amountInput');
    const confirmBtn = document.getElementById('amountConfirmBtn');
    const cancelBtn = document.getElementById('amountCancelBtn');

    labelEl.textContent = label;
    input.value = '';
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 50);

    const cleanup = (value) => {
      modal.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      resolve(value);
    };
    const onConfirm = () => cleanup(input.value.trim() || null);
    const onCancel = () => cleanup(null);
    const onKeydown = (ev) => { if (ev.key === 'Enter') onConfirm(); if (ev.key === 'Escape') onCancel(); };

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

let _wiredClaimAddress = null;
function wireClaimActionsOnce(address) {
  if (_wiredClaimAddress === address) return; // already wired for this claim, avoid duplicate listeners
  _wiredClaimAddress = address;
  wireClaimActions(address);
}

function wireClaimActions(address) {
  const status = document.getElementById('statusMsg');
  const actionButtonIds = ['btnFund', 'btnBack', 'btnVerify', 'btnChallenge', 'btnPayout'];
  let isBusy = false;

  const setButtonsDisabled = (disabled) => {
    actionButtonIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  };

  const run = async (fn) => {
    if (isBusy) return; // ignore extra taps while a transaction is already in flight
    isBusy = true;
    setButtonsDisabled(true);
    try {
      await core.ensureConnected();
      status.textContent = 'Submitting transaction… waiting for validator consensus, this can take a while for AI verification.';
      await fn();
      status.textContent = 'Done.';
      await loadClaimDetails(address);
    } catch (e) {
      // The write may still have gone through on-chain even though the browser tab
      // lost track of it (common on mobile when switching to a wallet app). Re-check
      // the actual chain state before showing a hard error.
      status.textContent = 'Confirming on-chain state…';
      const loaded = await loadClaimDetails(address);
      if (!loaded) {
        status.textContent = 'If your transaction actually succeeded, refresh the page to check. Otherwise: ' + (e.message || String(e));
      }
    } finally {
      isBusy = false;
      setButtonsDisabled(false);
    }
  };

  document.getElementById('btnFund').addEventListener('click', () => run(async () => {
    const amount = await promptAmount('Stake amount in GEN');
    if (!amount) throw new Error('Cancelled');
    await core.writeClaim(address, 'fund_stake', [], core.toGenWei(amount));
  }));

  document.getElementById('btnBack').addEventListener('click', () => run(async () => {
    const amount = await promptAmount('Backing amount in GEN');
    if (!amount) throw new Error('Cancelled');
    await core.writeClaim(address, 'back_claim', [], core.toGenWei(amount));
  }));

  document.getElementById('btnVerify').addEventListener('click', () => run(async () => {
    await core.writeClaim(address, 'verify_claim', []);
  }));

  document.getElementById('btnChallenge').addEventListener('click', () => run(async () => {
    const amount = await promptAmount('Challenge stake in GEN (must be ≥ original stake)');
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
