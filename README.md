# TruthStake

[#truthstake](#truthstake)

An AI fact-checking bounty market built on **GenLayer Intelligent Contracts**. Users stake GEN behind claims they believe are true; GenLayer's leader/validator network independently researches each claim — using submitted sources plus its own live web access — and reaches consensus on a verdict. Wrong verdicts can be challenged on-chain for a fresh, independent re-verification.

## Why this is a different kind of project

Most quest/task platforms use GenLayer's AI only to grade a player's free-text answer against a rubric. TruthStake instead puts GenLayer's other headline capability — **native web access inside a smart contract** (`gl.nondet.web.render` / `gl.nondet.web.get`) — at the center of the product: validators actually browse the web to research a claim before voting, with no external oracle. The economic model is also structurally different from a quest/escrow flow:

- **Two-sided staking**: a submitter's stake and any backers' stakes only pay out together if the claim resolves TRUE.
- **On-chain dispute layer**: a `challenge_verdict()` call forces independent re-research and can slash the original stake to reward a successful challenger — there is no equivalent mechanic in a simple quest-completion escrow.
- **Verdict, not task completion**: the AI consensus output is a first-class epistemic judgment (TRUE / FALSE / MISLEADING / UNVERIFIABLE with a confidence score and reasoning), not a pass/fail on a generated task.

## Project Overview

[#project-overview](#project-overview)

A user connects a wallet and files a claim (the text of the claim, optional source URLs, and a GEN stake). The server deploys a dedicated `Claim` Intelligent Contract for that case and registers it in the shared `Registry` contract. The submitter funds the contract directly from their wallet. Anyone can then back the claim, trigger AI verification, challenge a verdict they disagree with, or — once resolved — claim their share of the payout.

## Tech Stack

[#tech-stack](#tech-stack)

| Layer     | Technologies                                                                 |
| --------- | ----------------------------------------------------------------------------- |
| Server    | Express 5, `dotenv`, `morgan`, `cors`, `genlayer-js` (contract deployment)     |
| Client    | Plain HTML/CSS/JS (ES modules), `genlayer-js` (CDN in the browser)            |
| Network   | GenLayer Bradbury testnet — staking and payouts in native GEN                 |
| Contracts | GenLayer Python Intelligent Contracts (`contracts/registry.py`, `contracts/claim.py`) |

## Repository Structure

[#repository-structure](#repository-structure)

```
truthstake/
├── public/            # Static frontend: case feed, submit form, case-file detail page
│   ├── css/styles.css
│   └── js/            # core.js (wallet + contract calls), main.js (page router)
├── contracts/
│   ├── registry.py     # Tracks all claims for the browse feed
│   └── claim.py         # One deployed instance per claim: stake, verify, challenge, payout
├── src/
│   ├── start.js         # HTTP API, page serving, claim deployment
│   └── config/network.js
└── package.json
```

## How a case moves through the system

1. **File** — `POST /api/claims` deploys a fresh `Claim` contract with the claim text, optional sources, and registers it with the `Registry`.
2. **Fund** — the submitter calls `fund_stake()` (payable) directly from their wallet to lock in their stake.
3. **Back** (optional) — anyone can call `back_claim()` (payable) before resolution to add to the TRUE-side pool.
4. **Verify** — anyone calls `verify_claim()`. Inside the contract, a leader validator renders each source URL with `gl.nondet.web.render`, feeds the evidence plus the claim into an LLM prompt via `gl.nondet.exec_prompt`, and returns a verdict. Other validators re-run the same process; `gl.vm.run_nondet` only accepts the result once they agree.
5. **Challenge** (optional, up to 2 times) — `challenge_verdict()` (payable, stake ≥ original) forces independent re-verification. A reversed verdict pays the challenger their stake back plus a bonus slashed from the original stake; an upheld verdict sends the challenge stake into the reward pool.
6. **Payout** — once resolved, `claim_payout()` returns the submitter's and backers' stake plus a proportional share of the reward pool if the claim was verified TRUE.

## Getting Started

[#getting-started](#getting-started)

```
npm install
# create a .env file in the root with the required variables (see the table below)
npm run dev            # or npm start
```

## Environment Variables

[#environment-variables](#environment-variables)

| Variable                                          | Purpose                                          |
| -------------------------------------------------- | ------------------------------------------------- |
| `PRIVATE_KEY`                                       | Server key used to deploy Claim contracts          |
| `IC_REGISTRY`                                       | Deployed Registry contract address on Bradbury     |
| `NATIVE_CURRENCY_NAME` / `NATIVE_CURRENCY_SYMBOL`   | Optional, for wallet network display               |
| `PORT`                                              | HTTP server port                                   |

### First-time deployment

1. Deploy `contracts/registry.py` once via GenLayer Studio (or the GenLayer CLI) to Bradbury and copy the resulting address into `IC_REGISTRY`.
2. Start the server. Every claim a user files from `/submit` deploys its own `contracts/claim.py` instance automatically and registers it against that Registry address.

## Testing

[#testing](#testing)

`tests/test.py` is an end-to-end pytest suite that deploys a fresh Registry and a series of Claim contracts against a local **GenLayer Studio** instance, following [GenLayer's official testing pattern](https://docs.genlayer.com/developers/decentralized-applications/testing). It does not touch Bradbury or your `.env` — it's fully self-contained per run.

```
pip install -r tests/requirements.txt
# start GenLayer Studio locally first
pytest tests/test.py -v -s
```

What it covers:

- Registry starts empty and records the deployer as admin
- Funding a claim registers it in the Registry
- Only the submitter can fund their own claim
- Backers can add to the pool before resolution
- AI verification resolves a well-sourced true claim and a well-sourced false claim to a plausible verdict
- Payout succeeds once on a TRUE verdict and cannot be claimed twice
- Challenges are rejected before resolution and below the minimum stake
- The Registry's status mirrors the Claim contract's verdict after resolution

Because verification calls a live LLM with web access, verdict-dependent assertions are written to tolerate reasonable model variance (e.g. TRUE/MISLEADING/UNVERIFIABLE for a true claim) rather than asserting an exact string every time.

---

© TruthStake — an AI fact-checking bounty market powered by GenLayer.
