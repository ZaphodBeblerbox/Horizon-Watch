#!/usr/bin/env python3
"""
train_detection_classifier.py — fit the smoke-candidate classifier on what
analysts said, and measure the rules against the labelled set.

Labels come from two places:

  * analysts' answers in the detection_feedback table (DetectionFeedback.jsx
    -> POST /api/imagery/detections/{id}/feedback). Each row carries the
    features the classifier decided on, so no imagery is needed.
      --db PATH       a local sqlite copy (default: backend's own akili.db)
      --prod          read production READ-ONLY over `railway ssh` (mode=ro)
  * the hand-labelled prod sample, backend/data/smoke_labelled_set.json
    (--labelled; built 2026-10-13, see its "method" note).

    # how the hand rules do on the labelled set (precision / recall per class)
    python tools/train_detection_classifier.py --rules-report

    # fit a model from feedback + the labelled set; writes
    # backend/data/detection_classifier.json, which smoke_classify.classify()
    # then uses (rules stay the fallback and supply the reasons)
    python tools/train_detection_classifier.py --prod --write

A model is only written with at least MIN_LABELS labels over at least two
classes (--force to override): a model fitted on a handful of answers would
overrule physics it knows less than. Its leave-one-out accuracy is printed
next to the rules' so the swap is a decision, not a default.
"""
from __future__ import annotations

import argparse
import base64
import collections
import datetime
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(os.path.dirname(HERE), "backend")
sys.path.insert(0, BACKEND)

LABELLED = os.path.join(BACKEND, "data", "smoke_labelled_set.json")
MIN_LABELS = 40

PROD_EXPORT = r'''
import os, sqlite3, json, sys
c = sqlite3.connect(f"file:{os.environ['DATA_DIR']}/akili.db?mode=ro", uri=True)
c.row_factory = sqlite3.Row
try:
    rows = [dict(r) for r in c.execute("select * from detection_feedback")]
except sqlite3.OperationalError:
    rows = []
sys.stdout.write("JSONSTART" + json.dumps(rows) + "JSONEND\n")
'''


def feedback_from_prod() -> list[dict]:
    b64 = base64.b64encode(PROD_EXPORT.encode()).decode()
    p = subprocess.run(["railway", "ssh", "-s", "Horizon-Watch", "--", f"cd /app && echo {b64} | base64 -d | python -"],
                       capture_output=True, text=True, timeout=300)
    t = p.stdout + p.stderr
    a, b = t.find("JSONSTART"), t.find("JSONEND")
    if a < 0 or b < 0:
        sys.exit(f"prod export failed:\n{t[-1500:]}")
    rows = json.loads(t[a + 9:b])
    for r in rows:
        if isinstance(r.get("features"), str):
            try:
                r["features"] = json.loads(r["features"])
            except ValueError:
                r["features"] = None
    return rows


def feedback_from_db(path: str | None) -> list[dict]:
    from sqlalchemy import create_engine
    import detection_feedback as fb
    if path:
        eng = create_engine(f"sqlite:///{path}")
    else:
        from database import engine as eng
    return fb.all_rows(eng)


def examples_from_feedback(rows: list[dict]) -> list[dict]:
    """One example per detection: the label most users gave (ties: latest)."""
    import detection_feedback as fb
    by_det = collections.defaultdict(list)
    for r in rows:
        lab = fb.label_of(r)
        if lab and isinstance(r.get("features"), dict):
            by_det[r["detection_id"]].append((r.get("updated_at") or "", lab, r["features"]))
    out = []
    for det, xs in by_det.items():
        votes = collections.Counter(l for _, l, _ in xs)
        top = max(votes.values())
        lab = [l for t, l, _ in sorted(xs, reverse=True) if votes[l] == top][0]
        out.append({"id": det, "label": lab, "features": xs[-1][2], "source": "feedback"})
    return out


def examples_from_labelled(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    d = json.load(open(path))
    return [{"id": x["detection_id"], "label": x["label"], "features": x["features"], "source": "labelled"}
            for x in d.get("items", []) if x.get("label") not in (None, "", "unsure") and x.get("features")]


def scores(pairs: list[tuple[str, str]], positive: str = "smoke_plume") -> dict:
    """Precision / recall for one class, and overall accuracy, from (truth, predicted)."""
    tp = sum(1 for t, p in pairs if t == positive and p == positive)
    fp = sum(1 for t, p in pairs if t != positive and p == positive)
    fn = sum(1 for t, p in pairs if t == positive and p != positive)
    acc = sum(1 for t, p in pairs if t == p) / max(1, len(pairs))
    return {"n": len(pairs), "tp": tp, "fp": fp, "fn": fn,
            "precision": (tp / (tp + fp)) if tp + fp else None, "recall": (tp / (tp + fn)) if tp + fn else None,
            "accuracy": round(acc, 3)}


def is_finding_pairs(pairs):
    import smoke_classify as sc
    return [("pub" if sc.is_finding(t) else "no", "pub" if sc.is_finding(p) else "no") for t, p in pairs]


def rules_report(examples: list[dict], show: bool = True) -> dict:
    import smoke_classify as sc
    pairs = []
    for e in examples:
        cls, _conf, _why = sc._rule_class(e["features"])
        pairs.append((e["label"], cls))
    s = scores(pairs)
    pub = scores(is_finding_pairs(pairs), positive="pub")
    if show:
        print(f"RULES on {len(pairs)} labelled examples")
        print(f"  smoke_plume: precision {s['precision']}, recall {s['recall']} (tp {s['tp']}, fp {s['fp']}, fn {s['fn']})")
        print(f"  published-or-not: precision {pub['precision']}, recall {pub['recall']} (tp {pub['tp']}, fp {pub['fp']}, fn {pub['fn']})")
        print(f"  exact class accuracy {s['accuracy']}")
        conf = collections.Counter(pairs)
        print("  confusion (truth -> predicted):")
        for (t, p), n in sorted(conf.items()):
            print(f"    {t:20s} -> {p:20s} {n}")
    return {"smoke": s, "published": pub, "pairs": pairs}


def fit(examples: list[dict]):
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    import smoke_classify as sc
    X = np.array([sc.vector(e["features"]) for e in examples])
    y = np.array([e["label"] for e in examples])
    mean, scale = X.mean(axis=0), X.std(axis=0)
    scale[scale == 0] = 1.0
    Xs = (X - mean) / scale
    clf = LogisticRegression(max_iter=2000, C=0.5, class_weight="balanced")
    clf.fit(Xs, y)
    # leave-one-out accuracy, honest about a small set
    loo = []
    for i in range(len(y)):
        m = np.ones(len(y), bool)
        m[i] = False
        if len(set(y[m])) < 2:
            continue
        c = LogisticRegression(max_iter=2000, C=0.5, class_weight="balanced").fit(Xs[m], y[m])
        loo.append((y[i], c.predict(Xs[i:i + 1])[0]))
    model = {"features": list(sc.FEATURES), "mean": mean.tolist(), "scale": scale.tolist(),
             "coef": clf.coef_.tolist() if len(clf.classes_) > 2 else clf.coef_[0].tolist(),
             "intercept": clf.intercept_.tolist(), "classes": clf.classes_.tolist(), "n": int(len(y)),
             "by_class": dict(collections.Counter(y.tolist())),
             "trained_at": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"}
    return model, loo


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prod", action="store_true", help="read analysts' feedback from production (read-only)")
    ap.add_argument("--db", help="a local sqlite file with a detection_feedback table")
    ap.add_argument("--no-feedback", action="store_true", help="use the labelled set only")
    ap.add_argument("--labelled", default=LABELLED)
    ap.add_argument("--rules-report", action="store_true")
    ap.add_argument("--write", action="store_true", help=f"write {os.path.relpath(os.path.join(BACKEND, 'data', 'detection_classifier.json'))}")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)

    ex = examples_from_labelled(a.labelled)
    print(f"labelled set: {len(ex)} examples {dict(collections.Counter(e['label'] for e in ex))}")
    if not a.no_feedback and not a.rules_report:
        rows = feedback_from_prod() if a.prod else feedback_from_db(a.db)
        fx = examples_from_feedback(rows)
        print(f"analyst feedback: {len(rows)} answers -> {len(fx)} usable examples {dict(collections.Counter(e['label'] for e in fx))}")
        seen = {e["id"] for e in fx}
        ex = fx + [e for e in ex if e["id"] not in seen]       # an analyst's answer beats the hand label
    if a.rules_report or not ex:
        rules_report(ex)
        return
    rules_report(ex)
    classes = set(e["label"] for e in ex)
    if (len(ex) < MIN_LABELS or len(classes) < 2) and not a.force:
        print(f"\nNot fitting: {len(ex)} labels over {len(classes)} class(es); need {MIN_LABELS}+ over 2+ (--force to override).")
        return
    model, loo = fit(ex)
    s = scores(loo)
    print(f"\nMODEL leave-one-out on {s['n']}: smoke precision {s['precision']}, recall {s['recall']}, accuracy {s['accuracy']}")
    if a.write:
        import smoke_classify as sc
        with open(sc.MODEL_PATH, "w") as fh:
            json.dump(model, fh, indent=1)
        print(f"wrote {sc.MODEL_PATH}")
    else:
        print("(dry: --write to save it)")


if __name__ == "__main__":
    main()
