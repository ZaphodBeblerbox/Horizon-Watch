"""
eval_live_incident.py — one-off evaluation of the live-incident extractor
against data/live_incident_fixtures.json (owner 2026-10-22). Not a test: it
calls the real model (OPENAI_API_KEY from the environment, never from a file)
and the real geocoder, and costs a few cents.

    OPENAI_API_KEY=... python eval_live_incident.py [out.json]

It scores three readings of every fixture, as the map would show them:
  BEFORE  the pipeline as it was: telegram_ingest.SYSTEM through the same
          batch call, then the old publish rule (a kinetic or unrest event
          with a precise place that the geocoder finds inside the model's
          country). A pin was shown as a live signal at the post's own time.
  AFTER   the strict extractor and the code's verdict (live_incident.decide):
          shown only when the verdict is "live" with a pin.
  RULES   the deterministic path used when the model is out
          (telegram_rules + live_incident.rule_live), no model at all.

A shown pin is CORRECT only when the fixture is truly live, its place is
stated in the text, and the pin lies within the fixture's tolerance of the
true point. Precision = correct / shown; recall = correct / expected.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import live_incident as li                                       # noqa: E402
import telegram_ingest as tg                                      # noqa: E402


def km(a, b):
    r = 6371.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def judge(fx, shown_pin):
    """(shown, correct, located_right_when_truly_live)"""
    t = fx["truth"]
    if shown_pin is None:
        return False, False
    ok = bool(t["live"] and t["pin"] and km(shown_pin, (t["pin"]["lat"], t["pin"]["lon"])) <= t["pin"]["tol_km"])
    return True, ok


def main():
    fixtures = json.load(open(os.path.join(HERE, "data", "live_incident_fixtures.json")))
    now = li.parse_utc(fixtures["now"])
    posts = fixtures["posts"]
    for fx in posts:
        fx["published_at"] = li.iso(now - dt.timedelta(minutes=fx["minutes_ago"]))
    out = {fx["id"]: {"cat": fx["cat"], "lang": fx["lang"], "truth": fx["truth"]} for fx in posts}
    # EVAL_REUSE=<earlier result>: reuse its model answers (no model cost) and re-decide with the current code
    prev = json.load(open(os.environ["EVAL_REUSE"]))["items"] if os.environ.get("EVAL_REUSE") else {}

    # ── BEFORE: the old SYSTEM prompt, 15 posts a call, then the old publish rule
    import openai_gate
    cost = {"before": 0.0, "after": 0.0}
    rows = [(f"fx_{i}", fx["source_name"], fx["text"], i, "aggregator", None, "none", fx["published_at"], None, None, "channel")
            for i, fx in enumerate(posts)]
    answers = []
    for i in range(0, len(rows), 8):
        if prev:
            break
        for attempt in range(3):
            try:
                res = tg._model_pass(rows[i:i + 8]) or []
                answers += (res + [{}] * 8)[:len(rows[i:i + 8])]        # a short answer is unread posts, not a shift
                break
            except Exception as e:                                   # noqa: BLE001
                print("before call failed, retrying:", type(e).__name__, flush=True)
                if attempt == 2:
                    raise
    for fx, x in zip(posts, answers if answers else [{}] * len(posts)):
        if prev and fx["id"] in prev:
            out[fx["id"]]["before"] = prev[fx["id"]]["before"]
            continue
        x = x or {}
        kinetic = (x.get("event_type") or "other") in tg.KINETIC or x.get("event_type") == "unrest"
        hit = why = None
        if x.get("relevant") and kinetic:
            hit, why = tg.locate(x.get("place"), x.get("precision"), x.get("country_code"))
        out[fx["id"]]["before"] = {"pin": hit and [hit["lat"], hit["lon"]], "place": x.get("place"), "cc": x.get("country_code"),
                                   "type": x.get("event_type"), "why": why}
    print("before done", flush=True)

    # ── AFTER: the strict extractor + the code
    for fx in posts:
        if not li.prefilter(fx["text"])[0]:                        # production never sends these to the model
            out[fx["id"]]["after"] = {"pin": None, "verdict": "skipped: prefilter", "place": None, "query": None, "model": None}
            out[fx["id"]]["after_fb"] = {"pin": None, "verdict": "skipped: prefilter"}
            continue
        raw = ((prev.get(fx["id"]) or {}).get("after") or {}).get("model")
        if raw is None:
            raw, c = li.extract(fx["text"], fx["published_at"], fx["source_name"], fx["source_region"])
            cost["after"] += c
        d = li.decide(raw, fx["text"], fx["published_at"], now)
        out[fx["id"]]["after"] = {"pin": d["pin"] and [d["pin"]["lat"], d["pin"]["lon"]], "verdict": d["verdict"],
                                  "place": d["name"], "query": (d["audit"].get("geocode") or {}).get("queries"),
                                  "model": raw}
        li.COARSER_FALLBACK = True                       # the same answers, with the optional coarser fallback
        d2 = li.decide(raw, fx["text"], fx["published_at"], now)
        li.COARSER_FALLBACK = False
        out[fx["id"]]["after_fb"] = {"pin": d2["pin"] and [d2["pin"]["lat"], d2["pin"]["lon"]], "verdict": d2["verdict"]}
    print("after done", flush=True)

    # ── RULES: the model is out
    import telegram_rules
    for fx in posts:
        x = telegram_rules.read(fx["text"], None, "aggregator")
        pin = None
        why = "not an event by rule"
        if x["relevant"]:
            hit, place, cc, why = telegram_rules.resolve(x, None)
            if hit:
                is_live, lw = li.rule_live(fx["text"], fx["published_at"], now)
                if is_live:
                    pin = [hit["lat"], hit["lon"]]
                else:
                    why = "not live by rule: " + lw
        out[fx["id"]]["rules"] = {"pin": pin, "why": why}
    print("rules done", flush=True)

    # ── the tables
    def score(key):
        shown = correct = expected = placed_right = placed = 0
        for fx in posts:
            t = fx["truth"]
            pin = out[fx["id"]][key]["pin"]
            s, ok = judge(fx, tuple(pin) if pin else None)
            shown += s
            correct += ok
            expected += bool(t["live"] and t["pin"])
            if s and t["live"] and t["pin"]:
                placed += 1
                placed_right += ok
            out[fx["id"]][key]["shown"], out[fx["id"]][key]["correct"] = s, ok
        return {"shown": shown, "correct": correct, "wrong": shown - correct, "expected": expected,
                "precision": round(correct / shown, 3) if shown else None, "recall": round(correct / expected, 3) if expected else None,
                "location_accuracy_when_shown_for_a_real_live_item": round(placed_right / placed, 3) if placed else None}
    summary = {k: score(k) for k in ("before", "after", "after_fb", "rules")}
    by_cat = {}
    for fx in posts:
        c = by_cat.setdefault(fx["cat"], {"n": 0, "before_shown": 0, "after_shown": 0, "rules_shown": 0,
                                           "before_ok": 0, "after_ok": 0, "rules_ok": 0, "after_fb_shown": 0, "after_fb_ok": 0})
        c["n"] += 1
        for k in ("before", "after", "after_fb", "rules"):
            c[f"{k}_shown"] += out[fx["id"]][k]["shown"]
            c[f"{k}_ok"] += out[fx["id"]][k]["correct"]
    result = {"n": len(posts), "summary": summary, "by_category": by_cat, "cost_usd_after_calls": round(cost["after"], 5), "items": out}
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "data", "live_incident_eval.json")
    json.dump(result, open(path, "w"), ensure_ascii=False, indent=1)
    print(json.dumps({"n": len(posts), "summary": summary, "by_category": by_cat, "cost_after": cost["after"]}, indent=1))


if __name__ == "__main__":
    main()
