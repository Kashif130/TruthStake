import express from 'express';
import dotenv from 'dotenv';
import morgan from 'morgan';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { createAccount, createClient } from 'genlayer-js';
import { testnetBradbury, studionet } from 'genlayer-js/chains';
import { TransactionStatus } from 'genlayer-js/types';
import {
  bradburyNetwork,
  studionetNetwork,
  getPrivateKey,
  getRegistryBradbury,
  getRegistryStudioNet
} from './config/network.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const privateKey = getPrivateKey();
const account = createAccount(`0x${privateKey.replace(/^0x/, '')}`);

const genLayerClient = createClient({ chain: testnetBradbury, account });
const genLayerClientStudioNet = createClient({ chain: studionet, account });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use(express.static(path.join(__dirname, '../public')));

const PAGES = ['submit', 'claim', 'faq'];
PAGES.forEach((page) => {
  app.get(`/${page}`, (_req, res) => {
    res.sendFile(path.join(__dirname, `../public/${page}.html`));
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'truthstake' });
});

app.get('/api/config/network_bradbury', (_req, res) => {
  res.json(bradburyNetwork);
});

app.get('/api/config/network_studionet', (_req, res) => {
  res.json(studionetNetwork);
});

app.get('/api/config/registry', (_req, res) => {
  res.json({
    bradbury: getRegistryBradbury(),
    studionet: getRegistryStudioNet()
  });
});

// Deploy a new Claim contract on Bradbury and return its address.
// The submitter then funds it directly from their own wallet via fund_stake().
app.post('/api/claims', async (req, res) => {
  try {
    const { submitter, claimText, sources, network } = req.body;

    if (!submitter || !claimText || !claimText.trim()) {
      return res.status(400).json({ error: 'submitter and claimText are required' });
    }

    const cleanSources = (sources || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .join(',');

    const createdAt = Date.now();
    const registryAddress = network === 'studionet' ? getRegistryStudioNet() : getRegistryBradbury();

    const deployFn = network === 'studionet' ? deployContractStudioNet : deployContract;
    const contractAddress = await deployFn(
      registryAddress,
      submitter.trim(),
      claimText.trim(),
      cleanSources,
      createdAt
    );

    if (!contractAddress) {
      return res.status(400).json({ error: 'Error deploying claim contract' });
    }

    return res.json({ contract: contractAddress, createdAt });
  } catch (e) {
    console.error('Error creating a claim:', e);
    return res.status(500).json({ error: 'Error creating a claim' });
  }
});

// Convenience read-through endpoints (frontend can also read directly via genlayer-js)
app.get('/api/claims', async (req, res) => {
  try {
    const network = req.query.network === 'studionet' ? 'studionet' : 'bradbury';
    const limit = parseInt(req.query.limit || '50', 10);
    const client = network === 'studionet' ? genLayerClientStudioNet : genLayerClient;
    const registryAddress = network === 'studionet' ? getRegistryStudioNet() : getRegistryBradbury();

    const result = await client.readContract({
      address: registryAddress,
      functionName: 'get_claims',
      args: [limit],
    });
    return res.json(JSON.parse(result));
  } catch (e) {
    console.error('Error listing claims:', e);
    return res.status(500).json({ error: 'Error listing claims' });
  }
});

app.get('/api/claims/:address', async (req, res) => {
  try {
    const network = req.query.network === 'studionet' ? 'studionet' : 'bradbury';
    const client = network === 'studionet' ? genLayerClientStudioNet : genLayerClient;

    const result = await client.readContract({
      address: req.params.address,
      functionName: 'get_claim_details',
      args: [],
    });
    return res.json(JSON.parse(result));
  } catch (e) {
    console.error('Error reading claim:', e);
    return res.status(500).json({ error: 'Error reading claim' });
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`TruthStake server listening on http://localhost:${PORT}`);
  });
}

async function deployContract(registry, submitter, claimText, sources, createdAt) {
  const contractPath = path.join(__dirname, '../contracts/claim.py');
  const contractCode = readFileSync(contractPath, 'utf-8');

  const hash = await genLayerClient.deployContract({
    code: contractCode,
    args: [registry, submitter, claimText, sources, createdAt],
    leaderOnly: false,
  });
  console.log('Claim deploy tx on Bradbury:', hash);
  const receipt = await genLayerClient.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 200,
    interval: 5000,
  });
  return receipt.data?.contract_address ?? receipt.txDataDecoded?.contractAddress;
}

async function deployContractStudioNet(registry, submitter, claimText, sources, createdAt) {
  const contractPath = path.join(__dirname, '../contracts/claim.py');
  const contractCode = readFileSync(contractPath, 'utf-8');

  const hash = await genLayerClientStudioNet.deployContract({
    code: contractCode,
    args: [registry, submitter, claimText, sources, createdAt],
    leaderOnly: false,
  });
  console.log('Claim deploy tx on Studionet:', hash);
  const receipt = await genLayerClientStudioNet.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 200,
    interval: 5000,
  });
  return receipt.data?.contract_address ?? receipt.txDataDecoded?.contractAddress;
}

export default app;
