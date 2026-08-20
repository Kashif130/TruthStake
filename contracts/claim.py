# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
import time

VALID_VERDICTS = ("true", "false", "misleading", "unverifiable")
MAX_CHALLENGES = 2
CHALLENGE_SLASH_BPS = 2000  # 20% of submitter stake slashed to a successful challenger


class Claim(gl.Contract):
    registry: Address
    submitter: Address
    claim_text: str
    sources: str
    created_at: str

    stake: u256
    backers: TreeMap[Address, u256]
    backers_paid: TreeMap[Address, bool]
    total_backed: u256

    status: str
    confidence: u256
    verdict_reasoning: str
    resolved: bool

    challenge_active: bool
    challenge_count: u256
    challenger: Address
    challenge_stake: u256
    reward_pool: u256
    submitter_paid: bool

    def __init__(
        self,
        registry_value: str,
        submitter_value: str,
        claim_text_value: str,
        sources_value: str,
        created_at_value: int
    ):
        self.registry = Address(registry_value)
        self.submitter = Address(submitter_value)
        self.claim_text = claim_text_value
        self.sources = sources_value
        self.created_at = str(created_at_value)

        self.stake = u256(0)
        self.total_backed = u256(0)

        self.status = "pending"
        self.confidence = u256(0)
        self.verdict_reasoning = ""
        self.resolved = False

        self.challenge_active = False
        self.challenge_count = u256(0)
        self.challenger = Address("0x0000000000000000000000000000000000000000")
        self.challenge_stake = u256(0)
        self.reward_pool = u256(0)
        self.submitter_paid = False

    @gl.public.write.payable
    def fund_stake(self):
        if gl.message.sender_address.as_hex.lower() != self.submitter.as_hex.lower():
            raise Exception("Only the submitter can fund the initial stake")
        if self.stake > 0:
            raise Exception("Claim already funded")
        if gl.message.value <= 0:
            raise Exception("Stake must be greater than zero")
        self.stake = u256(gl.message.value)
        registry_contract = gl.get_contract_at(self.registry)
        registry_contract.emit().add_claim(
            self.submitter.as_hex,
            self.claim_text,
            str(self.stake),
            int(float(self.created_at))
        )

    @gl.public.write.payable
    def back_claim(self):
        if self.stake == 0:
            raise Exception("Claim not funded yet")
        if self.resolved:
            raise Exception("Claim already resolved, staking window closed")
        if gl.message.value <= 0:
            raise Exception("Backing amount must be greater than zero")
        sender = gl.message.sender_address
        current = self.backers.get(sender, u256(0))
        self.backers[sender] = u256(current + gl.message.value)
        self.total_backed = u256(self.total_backed + gl.message.value)

    @gl.public.write
    def verify_claim(self):
        if self.stake == 0:
            raise Exception("Claim not funded yet")
        if self.resolved:
            raise Exception("Claim already resolved")
        self._run_verification(challenged=False)
        self.resolved = True
        registry_contract = gl.get_contract_at(self.registry)
        registry_contract.emit().update_status(self.status)

    @gl.public.write.payable
    def challenge_verdict(self):
        if not self.resolved:
            raise Exception("Nothing to challenge yet, claim is not resolved")
        if self.challenge_active:
            raise Exception("A challenge is already in progress")
        if int(self.challenge_count) >= MAX_CHALLENGES:
            raise Exception("Maximum number of challenges reached for this claim")
        if gl.message.value < self.stake:
            raise Exception("Challenge stake must be at least equal to the original stake")

        previous_status = self.status
        self.challenger = gl.message.sender_address
        self.challenge_stake = u256(gl.message.value)
        self.challenge_active = True

        self._run_verification(challenged=True)
        self.challenge_count = u256(int(self.challenge_count) + 1)

        if self.status == previous_status:
            # AI upheld the original verdict: challenger loses stake to the reward pool
            self.reward_pool = u256(self.reward_pool + self.challenge_stake)
        else:
            # AI reversed the verdict: challenger wins their stake back plus a slash bonus
            bonus = u256((self.stake * CHALLENGE_SLASH_BPS) // 10000)
            if bonus > self.stake:
                bonus = self.stake
            self.stake = u256(self.stake - bonus)
            payout = u256(self.challenge_stake + bonus)
            gl.emit_transfer(self.challenger, payout)

        self.challenge_active = False
        registry_contract = gl.get_contract_at(self.registry)
        registry_contract.emit().update_status(self.status)

    @gl.public.write
    def claim_payout(self):
        if not self.resolved:
            raise Exception("Claim not resolved yet")
        if self.challenge_active:
            raise Exception("A challenge is currently in progress")

        sender = gl.message.sender_address
        truthy = self.status == "true"

        if sender.as_hex.lower() == self.submitter.as_hex.lower():
            if self.submitter_paid:
                raise Exception("Already claimed")
            self.submitter_paid = True
            if truthy and self.stake > 0:
                share = self._reward_share(self.stake)
                gl.emit_transfer(self.submitter, u256(self.stake + share))
            return

        backed = self.backers.get(sender, u256(0))
        if backed == 0:
            raise Exception("No backing found for this address")
        if self.backers_paid.get(sender, False):
            raise Exception("Already claimed")
        self.backers_paid[sender] = True
        if truthy:
            share = self._reward_share(backed)
            gl.emit_transfer(sender, u256(backed + share))

    def _reward_share(self, amount: u256) -> u256:
        true_side_total = u256(self.stake + self.total_backed)
        if true_side_total == 0 or self.reward_pool == 0:
            return u256(0)
        return u256((self.reward_pool * amount) // true_side_total)

    def _run_verification(self, challenged: bool):
        claim_text = self.claim_text
        source_list = [s.strip() for s in self.sources.split(",") if s.strip()]
        challenge_note = (
            "IMPORTANT: This claim's previous verdict was formally challenged as "
            "potentially incorrect. Re-research independently and thoroughly before "
            "deciding again. Do not simply defer to a prior answer."
            if challenged else ""
        )

        def leader_fn():
            evidence_parts = []
            for url in source_list:
                try:
                    page_text = gl.nondet.web.render(url, mode="text")
                    evidence_parts.append(f"SOURCE ({url}):\n{page_text[:1500]}")
                except Exception:
                    evidence_parts.append(f"SOURCE ({url}): could not be retrieved")
            evidence = "\n\n".join(evidence_parts) if evidence_parts else "No sources were provided by the submitter."

            today_str = time.strftime("%Y-%m-%d", time.gmtime())

            prompt = f"""You are an impartial fact-checking validator on a decentralized truth-verification network. Multiple independent validators will review this same claim and must reach consensus.

TODAY'S REAL-WORLD DATE: {today_str}
Your own training data has a knowledge cutoff earlier than today. Dates at or before today's date above are NOT "in the future" — do not penalize a source or claim for referencing a recent or current date. Only treat a date as suspicious if it is genuinely after {today_str}.

CLAIM TO VERIFY:
"{claim_text}"

{challenge_note}

EVIDENCE FROM SUBMITTED SOURCES:
{evidence}

Research this claim carefully using the evidence above combined with your own knowledge. Be skeptical and look for missing context, outdated information, or exaggeration.

Return your verdict as one of exactly four options:
- TRUE: the claim is accurate and well-supported
- FALSE: the claim is factually incorrect
- MISLEADING: the claim contains some truth but is presented in a deceptive or out-of-context way
- UNVERIFIABLE: there is not enough reliable evidence to determine truth or falsehood

Respond ONLY with a JSON object in this exact format:
{{
    "verdict": "TRUE" | "FALSE" | "MISLEADING" | "UNVERIFIABLE",
    "confidence": int (0 to 100),
    "reasoning": str (2 to 3 concise sentences explaining the verdict)
}}
It is mandatory that you respond only using the JSON format above, nothing else.
Don't include any other words, characters, or markdown formatting.
Your output must be perfectly parsable by a JSON parser without errors.
"""
            result = gl.nondet.exec_prompt(prompt)
            parsed = json.loads(_extract_json_from_string(result))
            parsed["verdict"] = str(parsed["verdict"]).strip().lower()
            if parsed["verdict"] not in VALID_VERDICTS:
                parsed["verdict"] = "unverifiable"
            return parsed

        def validator_fn(leader_result: gl.vm.Result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_data = leader_result.calldata
            validator_data = leader_fn()
            return leader_data["verdict"] == validator_data["verdict"]

        result_ai = gl.vm.run_nondet(leader_fn, validator_fn)
        self.status = result_ai["verdict"]
        self.confidence = u256(int(result_ai["confidence"]))
        self.verdict_reasoning = result_ai["reasoning"]

    @gl.public.view
    def get_claim_details(self) -> str:
        return json.dumps({
            "registry": self.registry.as_hex,
            "submitter": self.submitter.as_hex,
            "claim_text": self.claim_text,
            "sources": self.sources,
            "stake": str(self.stake),
            "total_backed": str(self.total_backed),
            "status": self.status,
            "confidence": str(self.confidence),
            "verdict_reasoning": self.verdict_reasoning,
            "resolved": str(self.resolved),
            "challenge_active": str(self.challenge_active),
            "challenge_count": str(self.challenge_count),
            "reward_pool": str(self.reward_pool),
            "submitter_paid": str(self.submitter_paid),
            "created_at": self.created_at
        })

    @gl.public.view
    def get_my_backing(self) -> str:
        sender = gl.message.sender_address
        backed = self.backers.get(sender, u256(0))
        paid = self.backers_paid.get(sender, False)
        return json.dumps({"backed": str(backed), "paid": str(paid)})


def _extract_json_from_string(s: str) -> str:
    """
    Extract a JSON object from a string.

    Args:
        s (str): The string potentially containing a JSON object.

    Returns:
        str: The extracted JSON string, or an empty string if no valid JSON is found.
    """
    start_index = s.find("{")
    end_index = s.rfind("}")
    if start_index != -1 and end_index != -1 and start_index < end_index:
        return s[start_index : end_index + 1]
    else:
        return ""
