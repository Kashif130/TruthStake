# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
import json


@allow_storage
@dataclass
class ClaimMeta:
    submitter: Address
    contract: Address
    claim_text: str
    stake: u256
    status: str
    created_at: str

    def to_dict(self):
        return {
            "submitter": self.submitter.as_hex,
            "contract": self.contract.as_hex,
            "claim_text": self.claim_text,
            "stake": str(self.stake),
            "status": self.status,
            "created_at": self.created_at
        }


class Registry(gl.Contract):
    admins: DynArray[Address]
    banned: DynArray[str]
    claims: TreeMap[Address, ClaimMeta]
    claims_by_submitter: TreeMap[Address, TreeMap[Address, ClaimMeta]]

    def __init__(self):
        self.admins.append(gl.message.sender_address)

    @gl.public.write
    def add_admin(self, admin: str):
        self._only_admin()
        self.admins.append(Address(admin))

    @gl.public.write
    def ban_claim(self, contract: str):
        self._only_admin()
        self.banned.append(contract)

    @gl.public.write
    def add_claim(self, submitter: str, claim_text: str, stake: str, created_at: int):
        claim_contract = gl.message.sender_address
        submitter_addr = Address(submitter)
        meta = ClaimMeta(
            submitter=submitter_addr,
            contract=claim_contract,
            claim_text=claim_text,
            stake=u256(int(stake)),
            status="pending",
            created_at=str(created_at)
        )
        self.claims[claim_contract] = meta
        self.claims_by_submitter.get_or_insert_default(submitter_addr)[claim_contract] = meta

    @gl.public.write
    def update_status(self, status: str):
        claim_contract = gl.message.sender_address
        if claim_contract not in self.claims:
            return
        existing = self.claims[claim_contract]
        submitter_addr = existing.submitter
        updated = ClaimMeta(
            submitter=submitter_addr,
            contract=claim_contract,
            claim_text=existing.claim_text,
            stake=existing.stake,
            status=status,
            created_at=existing.created_at
        )
        self.claims[claim_contract] = updated
        submitter_map = self.claims_by_submitter.get(submitter_addr, None)
        if submitter_map is not None and claim_contract in submitter_map:
            submitter_map[claim_contract] = updated

    @gl.public.view
    def get_claims(self, limit: int) -> str:
        result = []
        for k, v in sorted(self.claims.items(), key=lambda kv: kv[1].created_at, reverse=True)[:limit]:
            if k.as_hex not in self.banned:
                result.append(v.to_dict())
        return json.dumps(result)

    @gl.public.view
    def get_claims_by_status(self, status: str, limit: int) -> str:
        result = []
        for k, v in sorted(self.claims.items(), key=lambda kv: kv[1].created_at, reverse=True):
            if k.as_hex not in self.banned and v.status == status:
                result.append(v.to_dict())
            if len(result) >= limit:
                break
        return json.dumps(result)

    @gl.public.view
    def get_claims_by_submitter(self, submitter: str, limit: int) -> str:
        q = self.claims_by_submitter.get(Address(submitter), None)
        result = []
        if q is not None:
            for k, v in sorted(q.items(), key=lambda kv: kv[1].created_at, reverse=True)[:limit]:
                result.append(v.to_dict())
        return json.dumps(result)

    @gl.public.view
    def get_admins(self) -> str:
        return json.dumps([a.as_hex for a in self.admins])

    def _only_admin(self):
        if gl.message.sender_address not in self.admins:
            raise Exception("You are not an admin")
