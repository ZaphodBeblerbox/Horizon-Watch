"""
eval_live_signals.py — before/after on REAL production posts of 2026-10-22 (owner's complaint "signals are still
not live"). Not a test: it calls the real extractor (OPENAI_API_KEY from the environment only) and the real
geocoder, about $0.05 for 45 posts.

    OPENAI_API_KEY=... python eval_live_signals.py [out.json]

data/live_signal_fixtures.json: posts [{id, channel, msg_id, posted_at, text, truth_live, why, before_pin}]
  truth_live: by the owner's rules, an act of the vocabulary happening now at a place the text names.
  before_pin: the production row had lat/lon (the pipeline of that day drew it as a signal).
Each post is judged at posted_at + 2 min (the extractor reads fresh posts). Reports, for BEFORE (pin as of
that day), RULE (model out) and AFTER (extractor + code): pins shown, real ones among them, missed real ones.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import live_incident as li                                       # noqa: E402


def main():
    fx = json.load(open(os.path.join(HERE, "data", "live_signal_fixtures.json")))["posts"]
    rows, cost = [], 0.0
    for p in fx:
        now = li.parse_utc(p["posted_at"]) + dt.timedelta(minutes=2)
        rule = li.rule_decide(p["text"], p["posted_at"], now)
        d, raw, c = None, None, 0.0
        if os.environ.get("OPENAI_API_KEY") and not os.environ.get("EVAL_NO_MODEL"):
            import openai
            client = openai.OpenAI()
            ok, _ = li.prefilter(p["text"])
            pre = li.story_cue(p["text"]) or (li.opinion_cue(p["text"]) and not li.act_by_words(p["text"]))
            if ok and not pre:
                raw, c = li.extract(p["text"], p["posted_at"], p.get("channel"), "", client=client)
                d = li.decide(raw, p["text"], p["posted_at"], now)
            else:
                d = {"verdict": "rejected before the model", "pin": None, "ok": False, "why": "prefilter/story/opinion"}
        cost += c
        shown_after = bool(d and d.get("verdict") == "live" and d.get("pin"))
        rows.append({"id": p["id"], "truth": p["truth_live"], "before": bool(p.get("before_pin")), "rule": rule["ok"],
                     "after": shown_after, "after_verdict": (d or {}).get("verdict"), "after_act": (d or {}).get("act"),
                     "after_place": (d or {}).get("name"), "why": p.get("why"), "text": p["text"][:90].replace("\n", " ")})

    def score(key):
        shown = [r for r in rows if r[key]]
        real = [r for r in shown if r["truth"]]
        missed = [r for r in rows if r["truth"] and not r[key]]
        return {"shown": len(shown), "real": len(real), "false": len(shown) - len(real), "missed": len(missed)}
    out = {"n": len(rows), "truth_live": sum(r["truth"] for r in rows), "cost_usd": round(cost, 4),
           "before": score("before"), "rule": score("rule"), "after": score("after"), "rows": rows}
    json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "data", "live_signal_eval.json"), "w"),
              ensure_ascii=False, indent=1)
    for k in ("before", "rule", "after"):
        print(k, out[k])
    print("cost", out["cost_usd"], "truth_live", out["truth_live"], "of", out["n"])
    for r in rows:
        if r["after"] != r["truth"]:
            print("AFTER MISMATCH", r["id"], "truth", r["truth"], r["after_verdict"], "|", r["text"])


if __name__ == "__main__":
    main()
