import { createClient } from "https://esm.sh/genlayer-js";
import { testnetBradbury } from "https://esm.sh/genlayer-js/chains";
import { TransactionStatus } from "https://esm.sh/genlayer-js/types";

let client = null;
let inited = false;
let registryAddress = null;

function maskAddress(a) { if (!a) return ''; return a.slice(0, 6) + '…' + a.slice(-4); }

function toGenDisplay(weiStr) {
  try {
    const wei = BigInt(weiStr || '0');
    const whole = wei / 1000000000000000000n;
    const frac = wei % 1000000000000000000n;
    if (frac === 0n) return whole.toString();
    const fracStr = (frac + 1000000000000000000n).toString().slice(1, 5).replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch { return '0'; }
}

function toGenWei(amountStr) {
  const [w, f = ''] = String(amountStr).split('.');
  const frac = (f + '000000000000000000').slice(0, 18);
  return (BigInt(w || '0') * 1000000000000000000n + BigInt(frac || '0')).toString();
}

async function fetchRegistryAddress() {
  if (registryAddress) return registryAddress;
  const cfg = await (await fetch('/api/config/registry')).json();
  registryAddress = cfg.bradbury;
  return registryAddress;
}

function updateAccount(account) {
  try {
    if (!account) { client = null; return; }
    client = createClient({ chain: testnetBradbury, account });
    queueMicrotask(() => checkPage());
  } catch (e) {
    console.error('Error updating account', e);
  }
}

async function connectWalletAndEnsureNetwork() {
  const net = await (await fetch('/api/config/network_bradbury')).json();
  if (!window.ethereum) throw new Error('No wallet extension found (install SubWallet or Talisman / a browser wallet)');
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: net.chainIdHex }] });
  } catch (e) {
    if (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902)) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: net.chainIdHex, chainName: net.chainName, rpcUrls: net.rpcUrls, nativeCurrency: net.nativeCurrency, blockExplorerUrls: net.blockExplorerUrls }]
      });
    } else { throw e; }
  }
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  return accounts[0];
}

function setUIConnected(address) {
  const addr = document.getElementById('addr'); if (addr) addr.textContent = maskAddress(address);
  const btn = document.getElementById('connectBtn'); if (btn) { btn.textContent = 'Disconnect'; btn.dataset.state = 'connected'; }
  setSectionsLocked(false);
}

function setUIDisconnected() {
  const addr = document.getElementById('addr'); if (addr) addr.textContent = '';
  const btn = document.getElementById('connectBtn'); if (btn) { btn.textContent = 'Connect Wallet'; btn.dataset.state = 'disconnected'; }
  setSectionsLocked(true);
}

function setSectionsLocked(locked) {
  ['sectionToolbar', 'sectionCards', 'sectionForm', 'sectionDossier'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('is-locked', locked);
    el.setAttribute('aria-disabled', locked ? 'true' : 'false');
  });
}

async function disconnect() {
  localStorage.removeItem('connectedAddress');
  setUIDisconnected();
}

async function connect() {
  const address = await connectWalletAndEnsureNetwork();
  localStorage.setItem('connectedAddress', address);
  setUIConnected(address);
  updateAccount(address);
  return address;
}

let _checkPageImpl = () => {};
function setCheckPageImpl(fn) { _checkPageImpl = fn; }
function checkPage() { _checkPageImpl(); }

function isConnected() { return !!localStorage.getItem('connectedAddress'); }
function getAddress() { return localStorage.getItem('connectedAddress') || ''; }

async function ensureConnected() {
  if (!isConnected()) throw new Error('Please connect your wallet first');
  return getAddress();
}

function init() {
  if (inited) return;
  inited = true;
  const btn = document.getElementById('connectBtn');
  if (btn) {
    btn.dataset.state = 'disconnected';
    btn.addEventListener('click', async () => {
      try {
        if (btn.dataset.state === 'connected') { await disconnect(); }
        else { await connect(); }
      } catch (e) { alert(e.message || String(e)); }
    });
  }
  const saved = localStorage.getItem('connectedAddress');
  if (saved) {
    setUIConnected(saved);
    queueMicrotask(() => updateAccount(saved));
  } else {
    setUIDisconnected();
  }
}

// --- Contract read/write helpers ---

async function readClaim(contractAddress, functionName, args = []) {
  if (!client) throw new Error('Wallet not connected');
  return client.readContract({ address: contractAddress, functionName, args });
}

async function writeClaim(contractAddress, functionName, args = [], valueWei = '0') {
  if (!client) throw new Error('Wallet not connected');
  const hash = await client.writeContract({
    address: contractAddress,
    functionName,
    args,
    value: BigInt(valueWei || '0'),
  });
  return client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 200, interval: 5000 });
}

export {
  maskAddress,
  toGenDisplay,
  toGenWei,
  fetchRegistryAddress,
  getAddress,
  isConnected,
  ensureConnected,
  connect,
  disconnect,
  init,
  checkPage,
  setCheckPageImpl,
  readClaim,
  writeClaim,
};
