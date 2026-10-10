"""Registered channels marked join: true are joined, a few a pass."""
import asyncio
import json

import telegram_ingest as tg


class FakeClient:
    def __init__(self): self.calls = []
    async def __call__(self, req): self.calls.append(req.channel)


def test_joins_only_what_is_registered_and_not_joined(tmp_path, monkeypatch):
    reg = {"_doc": "x", "a_chan": {"role": "local", "join": True}, "b_chan": {"role": "local", "join": True},
           "c_chan": {"role": "local", "join": True}, "old": {"role": "local"}, "known": {"role": "local", "join": True}}
    f = tmp_path / "reg.json"; f.write_text(json.dumps(reg))
    monkeypatch.setattr(tg, "CHANNELS_FILE", str(f))
    c = FakeClient()
    done = asyncio.run(tg._join_registered(c, {"known"}))
    assert done == ["a_chan", "b_chan"] and c.calls == ["a_chan", "b_chan"]


def test_the_registered_africa_channels_are_well_formed():
    reg = json.load(open(tg.CHANNELS_FILE))
    for k in ("sahelscopeml223", "PresCouncilSudan", "africaninitiativefr", "africaninitiativeen", "GaroweOnline"):
        assert reg[k]["join"] and reg[k]["role"] in tg.ROLE_LABEL
