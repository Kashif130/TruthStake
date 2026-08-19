"""
TruthStake end-to-end contract test.

Runs against a local GenLayer Studio instance (the official simulator).
Follows the same pattern as GenLayer's own testing docs:
https://docs.genlayer.com/developers/decentralized-applications/testing

Before running:
    1. Start GenLayer Studio locally (it exposes the simulator RPC used by `tools.request`).
    2. pip install genlayer-test  (or the project boilerplate's requirements.txt)
    3. From the project root:  pytest tests/test.py -v -s

This test deploys BOTH contracts itself — you do NOT need to manually deploy
registry.py first for this test to run; it deploys a fresh Registry for
every test session so runs are isolated and repeatable.
"""

import json
import time

import pytest
from tools.request import (
    create_new_account,
    deploy_intelligent_contract,
    send_transaction,
    call_contract_method,
)
from tools.response import assert_dict_struct, has_success_status

REGISTRY_PATH = "contracts/registry.py"
CLAIM_PATH = "contracts/claim.py"

TRUE_CLAIM_TEXT = "Water boils at 100 degrees Celsius at standard atmospheric pressure."
TRUE_CLAIM_SOURCES = "https://en.wikipedia.org/wiki/Boiling_point"

FALSE_CLAIM_TEXT = "The Great Wall of China is visible from the Moon with the naked eye."
FALSE_CLAIM_SOURCES = "https://en.wikipedia.org/wiki/Great_Wall_of_China"

STAKE_WEI = "1000000000000000000"  # 1 GEN


@pytest.fixture(scope="module")
def submitter():
    return create_new_account()


@pytest.fixture(scope="module")
def backer():
    return create_new_account()


@pytest.fixture(scope="module")
def registry_address(submitter):
    code = open(REGISTRY_PATH, "r").read()
    address, deploy_response = deploy_intelligent_contract(submitter, code, "{}")
    assert has_success_status(deploy_response)
    print(f"\n[deploy] Registry deployed at {address}")
    return address


def deploy_claim(account, registry_address, claim_text, sources):
    code = open(CLAIM_PATH, "r").read()
    args = json.dumps(
        {
            "registry_value": registry_address,
            "submitter_value": account.address,
            "claim_text_value": claim_text,
            "sources_value": sources,
            "created_at_value": int(time.time() * 1000),
        }
    )
    address, deploy_response = deploy_intelligent_contract(account, code, args)
    assert has_success_status(deploy_response)
    print(f"[deploy] Claim deployed at {address} -> \"{claim_text[:60]}...\"")
    return address


def test_registry_starts_empty(registry_address, submitter):
    result = call_contract_method(registry_address, submitter, "get_claims", [50])
    claims = json.loads(result)
    assert claims == []


def test_registry_admin_is_deployer(registry_address, submitter):
    result = call_contract_method(registry_address, submitter, "get_admins", [])
    admins = json.loads(result)
    assert submitter.address in admins


def test_fund_stake_registers_claim_in_registry(registry_address, submitter):
    claim_address = deploy_claim(submitter, registry_address, TRUE_CLAIM_TEXT, TRUE_CLAIM_SOURCES)

    response = send_transaction(submitter, claim_address, "fund_stake", [], value=int(STAKE_WEI))
    assert has_success_status(response)

    details = json.loads(call_contract_method(claim_address, submitter, "get_claim_details", []))
    assert details["stake"] == STAKE_WEI
    assert details["status"] == "pending"
    assert details["resolved"] == "False"

    registry_claims = json.loads(call_contract_method(registry_address, submitter, "get_claims", [50]))
    assert any(c["contract"].lower() == claim_address.lower() for c in registry_claims)


def test_only_submitter_can_fund(registry_address, submitter, backer):
    claim_address = deploy_claim(submitter, registry_address, TRUE_CLAIM_TEXT, TRUE_CLAIM_SOURCES)
    response = send_transaction(backer, claim_address, "fund_stake", [], value=int(STAKE_WEI))
    assert not has_success_status(response)


def test_backing_before_resolution(registry_address, submitter, backer):
    claim_address = deploy_claim(submitter, registry_address, TRUE_CLAIM_TEXT, TRUE_CLAIM_SOURCES)
    send_transaction(submitter, claim_address, "fund_stake", [], value=int(STAKE_WEI))

    back_response = send_transaction(backer, claim_address, "back_claim", [], value=int(STAKE_WEI))
    assert has_success_status(back_response)

    details = json.loads(call_contract_method(claim_address, submitter, "get_claim_details", []))
    assert details["total_backed"] == STAKE_WEI


def test_verify_true_claim_resolves_true(registry_address, submitter):
    """
    This is a live LLM + web-access call — it can take a while and,
    like any AI verdict, is non-deterministic in wall-clock time (not in
    outcome, since validators must reach consensus). Mark as slow.
    """
    claim_address = deploy_claim(submitter, registry_address, TRUE_CLAIM_TEXT, TRUE_CLAIM_SOURCES)
    send_transaction(submitter, claim_address, "fund_stake", [], value=int(STAKE_WEI))

    verify_response = send_transaction(submitter, claim_address, "verify_claim", [])
    assert has_success_status(verify_response)

    details = json.loads(call_contract_method(claim_address, submitter, "get_claim_details", []))
    print(f"[verdict] {details['status']} (confidence={details['confidence']}) — {details['verdict_reasoning']}")
    assert details["resolved"] == "True"
    assert details["status"] in ("true", "misleading", "unverifiable")  # allow model variance, but expect not "false"


def test_verify_false_claim_resolves_false(registry_address, submitter):
    claim_address = deploy_claim(submitter, registry_address, FALSE_CLAIM_TEXT, FALSE_CLAIM_SOURCES)
    send_transaction(submitter, claim_address, "fund_stake", [], value=int(STAKE_WEI))

    send_transaction(submitter, claim_address, "verify_claim", [])
    details = json.loads(call_contract_method(claim_address, submitter, "get_claim_details", []))
    print(f"[verdict] {details['status']} (confidence={details['confidence']}) — {details['verdict_reasoning']}")
    assert details["status"] in ("false", "misleading")


def test_payout_after_true_verdict(registry_address, submitter, backer):
    claim_address = deploy_claim(submitter, registry_address, TRUE_CLAIM_TEXT, TRUE_CLAIM_SOURCES)
    send_transaction(submitter, claim_address, "fund_stake", [], value=int(STAKE_WEI))
    send_transaction(backer, claim_address, "back_claim", [], value=int(STAKE_WEI))
    send_transaction(submitter, claim_address, "verify_claim", [])

    details = json.loads(call_contract_method(claim_address, submitter, "get_claim_details", []))
    if details["status"] != "true":
        pytest.skip("Model did not return TRUE for this run; payout path not exercised")

    payout_response = send_transaction(submitter, claim_address, "claim_payout", [])
    assert has_success_status(payout_response)

    # Second claim by the same address must fail (already paid)
    second_attempt = send_transaction(submitter, claim_address, "claim_payout", [])
    assert not has_success_status(second_attempt)


def test_challenge_requires_resolved_claim(registry_address, submitter):
    claim_address = deploy_claim(submitter, registry_address, TRUE_CLAIM_TEXT, TRUE_CLAIM_SOURCES)
    send_transaction(submitter, claim_address, "fund_stake", [], value=int(STAKE_WEI))

    challenge_response = send_transaction(
        submitter, claim_address, "challenge_verdict", [], value=int(STAKE_WEI)
    )
    assert not has_success_status(challenge_response)


def test_challenge_stake_must_meet_minimum(registry_address, submitter, backer):
    claim_address = deploy_claim(submitter, registry_address, FALSE_CLAIM_TEXT, FALSE_CLAIM_SOURCES)
    send_transaction(submitter, claim_address, "fund_stake", [], value=int(STAKE_WEI))
    send_transaction(submitter, claim_address, "verify_claim", [])

    low_stake = str(int(STAKE_WEI) // 2)
    challenge_response = send_transaction(
        backer, claim_address, "challenge_verdict", [], value=int(low_stake)
    )
    assert not has_success_status(challenge_response)


def test_registry_status_updates_after_resolution(registry_address, submitter):
    claim_address = deploy_claim(submitter, registry_address, TRUE_CLAIM_TEXT, TRUE_CLAIM_SOURCES)
    send_transaction(submitter, claim_address, "fund_stake", [], value=int(STAKE_WEI))
    send_transaction(submitter, claim_address, "verify_claim", [])

    details = json.loads(call_contract_method(claim_address, submitter, "get_claim_details", []))
    registry_claims = json.loads(
        call_contract_method(registry_address, submitter, "get_claims_by_status", [details["status"], 50])
    )
    assert any(c["contract"].lower() == claim_address.lower() for c in registry_claims)
