"""
sequence_miner.py - what has historically followed what, and where.

The question this answers is the one the product keeps needing: "XYZ
just happened here; historically, what follows?" It answers it from
this system's own event history rather than from a model's intuitions,
and it shows the instances it counted so an analyst can disagree.

HOW IT AVOIDS SAYING SOMETHING TRUE AND USELESS. The obvious
implementation counts "B followed A" and reports the frequency, which
in a conflict corpus discovers that violence follows violence — a rule
with excellent support and no information. So every rule carries LIFT:
how much more often B follows A than B occurs anyway. Lift near 1.0
means the pairing is explained entirely by B being common, and those
rules are dropped no matter how much support they have.

WHY THE TYPES COME FROM STRUCTURED FIELDS ONLY. The temptation is to
derive an event category from the free-text description with keywords.
Measured on 400 GeoConfirmed descriptions, the word "drone" appears in
300 of them — because GeoConfirmed's material is largely drone FOOTAGE,
so the word describes the camera and not the weapon. A keyword
categoriser would have labelled three quarters of the corpus as drone
strikes and every rule built on it would have been an artefact of how
the evidence was filmed.

WHAT A RULE IS AND IS NOT. It is a correlation observed in a finite
history, with the count, the window and the examples attached. It is
not a cause, and it is not a forecast. The wording of every field here
is chosen so that a reader who only skims still cannot mistake it for
one.
"""
from __future__ import annotations

import datetime as _dt
from collections import Counter, defaultdict


def _day(value) -> _dt.date | None:
    s = str(value or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d %b %Y"):
        try:
            return _dt.datetime.strptime(s[:len(fmt) + 2].strip(), fmt).date()
        except ValueError:
            continue
    try:
        return _dt.date.fromisoformat(s[:10])
    except ValueError:
        return None


def mine(events: list, *, window_days: int = 14, min_support: int = 3,
         min_lift: float = 1.25, min_consequent: int = 20,
         max_rules: int = 300) -> dict:
    """Rules of the form "A here, then B here within N days".

    `events` are dicts with `t` (a date), `locale` (where the sequence
    is scoped — a country, a theatre) and `kind` (what happened).

    Sequences are scoped BY LOCALE on purpose. A strike in Sudan does
    not follow a strike in Ukraine just because the dates line up, and
    mining a global timeline produces exactly that kind of nonsense.
    """
    by_locale: dict = defaultdict(list)
    kind_total: Counter = Counter()
    for e in events or []:
        d = _day(e.get("t"))
        kind = (e.get("kind") or "").strip()
        locale = (e.get("locale") or "").strip()
        if not d or not kind or not locale:
            continue
        by_locale[locale].append((d, kind))
        kind_total[kind] += 1

    total_events = sum(kind_total.values())
    if not total_events:
        return {"rules": [], "events_considered": 0, "window_days": window_days}

    pair_count: Counter = Counter()
    pair_examples: dict = defaultdict(list)
    antecedent_count: Counter = Counter()
    # How many windows contain each kind at all, regardless of what
    # opened the window. This is the baseline confidence is compared
    # against — see the note where lift is computed.
    windows_with: Counter = Counter()
    total_windows = 0
    # Per locale, because a global baseline is distorted by whichever
    # theatre happens to dominate the corpus — see the lift note below.
    locale_windows: Counter = Counter()
    locale_windows_with: Counter = Counter()
    antecedent_locales: dict = defaultdict(set)

    for locale, rows in by_locale.items():
        rows.sort()
        n = len(rows)
        for i, (d_a, kind_a) in enumerate(rows):
            antecedent_count[kind_a] += 1
            total_windows += 1
            locale_windows[locale] += 1
            antecedent_locales[kind_a].add(locale)
            # Only what came AFTER, and only inside the window. A
            # symmetric count would report coincidence as sequence.
            seen_here: set = set()
            for j in range(i + 1, n):
                d_b, kind_b = rows[j]
                gap = (d_b - d_a).days
                if gap <= 0:
                    continue
                if gap > window_days:
                    break
                # Counted once per antecedent occurrence, so a flurry of
                # twenty B's does not make one A look twenty times more
                # predictive than it is.
                if kind_b in seen_here:
                    continue
                seen_here.add(kind_b)
                pair_count[(kind_a, kind_b)] += 1
                windows_with[kind_b] += 1
                locale_windows_with[(locale, kind_b)] += 1
                if len(pair_examples[(kind_a, kind_b)]) < 3:
                    pair_examples[(kind_a, kind_b)].append({
                        "locale": locale, "then_after_days": gap,
                        "first": d_a.isoformat(), "second": d_b.isoformat()})

    rules = []
    for (kind_a, kind_b), support in pair_count.items():
        if support < min_support:
            continue
        occurrences = antecedent_count.get(kind_a, 0)
        if not occurrences:
            continue
        # LIFT BREAKS ON RARE CONSEQUENTS, and it breaks loudly enough to
        # discredit the whole feature. Mining 74,809 GeoConfirmed events
        # produced "lift 41,383" for a faction appearing a couple of dozen
        # times in the corpus: the base rate was ~3e-5, so dividing by it
        # manufactured an enormous number out of a handful of rows. A
        # reader seeing 41,383 correctly stops believing the panel.
        #
        # So the consequent has to be common enough for its base rate to
        # mean something. This discards real co-occurrences between two
        # rare labels, which is the right trade: that is a fact about one
        # theatre's tagging, not a historical pattern.
        if kind_total.get(kind_b, 0) < min_consequent:
            continue
        confidence = support / occurrences
        # THE BASELINE HAS TO BE IN THE SAME UNIT AS THE CONFIDENCE.
        #
        # Comparing "how often does B follow A within the window" against
        # "B's share of all events" divides a per-window probability by a
        # per-event one, and the mismatch manufactures absurd numbers: on
        # the real corpus it produced lifts of 932 and, for rarer labels,
        # 41,383. Those are arithmetic, not findings, and a reader who
        # sees them is right to stop believing the panel.
        #
        # The honest baseline answers the same question the confidence
        # does: pick any event at random — how often is a B inside ITS
        # following window? Both sides are then per-window.
        #
        # AND IT HAS TO BE SCOPED TO THE SAME PLACES. A global baseline
        # is dominated by whichever theatre fills the corpus: GeoConfirmed
        # is 53,000 Ukraine events out of 74,809, so a Congolese faction
        # looked 400x rarer than chance and every DRC rule came back with
        # an absurd lift. Comparing a DRC sequence against a Ukrainian
        # base rate is not a comparison. So the baseline is computed over
        # the locales where the antecedent actually occurs.
        places = antecedent_locales.get(kind_a) or ()
        denom = sum(locale_windows[l] for l in places)
        numer = sum(locale_windows_with.get((l, kind_b), 0) for l in places)
        base = (numer / denom) if denom else 0
        if base <= 0:
            continue
        lift = confidence / base
        if lift < min_lift:
            continue
        rules.append({
            "if_this": kind_a,
            "then_this": kind_b,
            "within_days": window_days,
            # The three numbers that make this checkable rather than
            # impressive: how often it held, out of how many chances,
            # and how much better than chance.
            "support": support,
            "opportunities": occurrences,
            "confidence": round(confidence, 3),
            "lift": round(lift, 2),
            "same_kind": kind_a == kind_b,
            "examples": pair_examples[(kind_a, kind_b)],
            "basis": (f"In {support} of {occurrences} recorded instances of "
                      f"'{kind_a}', a '{kind_b}' followed in the same place "
                      f"within {window_days} days — {lift:.1f}x more often "
                      f"than '{kind_b}' occurs generally."),
            "caveat": ("A correlation in this system's own recorded history. "
                       "Not a cause, and not a forecast."),
        })

    # Lift first: a rule that beats the base rate is worth more than one
    # that merely happens a lot.
    rules.sort(key=lambda r: (-r["lift"], -r["support"]))
    return {"rules": rules[:max_rules], "found": len(rules),
            "events_considered": total_events, "locales": len(by_locale),
            "window_days": window_days,
            "note": ("Rules are correlations observed in recorded history, "
                     "scoped to one place, with the instances attached. "
                     f"Lift below {min_lift} is discarded as explained by "
                     f"base rate, and a consequent seen fewer than "
                     f"{min_consequent} times is discarded because its base "
                     "rate is too small to divide by.")}


def what_follows(rules: list, kind: str, *, limit: int = 8) -> list:
    """The rules that fire for something that just happened."""
    k = (kind or "").strip()
    out = [r for r in rules if r["if_this"] == k]
    out.sort(key=lambda r: (-r["lift"], -r["support"]))
    return out[:limit]


# ── adapters: this system's own history, in the miner's shape ─────────

def from_ucdp(conn) -> list:
    """UCDP: violence type, by country.

    A clean, closed vocabulary of three classes — state-based,
    non-state, one-sided against civilians — which is exactly what a
    sequence miner wants and what free text is not.
    """
    return [{"t": d, "locale": c, "kind": v}
            for d, c, v in conn.execute(
                "SELECT date, country, violence_type FROM ucdp_events"
                " WHERE date IS NOT NULL AND country IS NOT NULL"
                " AND violence_type IS NOT NULL")]


def from_geoconfirmed(conn) -> list:
    """GeoConfirmed: which faction was recorded acting, by theatre.

    Faction is a structured field; the description is not, and the
    module docstring records why that matters. Thirteen years of it.
    """
    return [{"t": d, "locale": t, "kind": f}
            for d, t, f in conn.execute(
                "SELECT date, theatre_slug, faction FROM geoconfirmed_placemarks"
                " WHERE date IS NOT NULL AND theatre_slug IS NOT NULL"
                " AND faction IS NOT NULL AND faction <> ''")]
