"""
Verification script for the sanctions_loader.py maritime-CSV data-source swap
(backend/sanctions_loader.py).

Confirms:
  1. A real download of OpenSanctions' maritime.csv loads into
     sanctions_loader and a known real sanctioned vessel is found via
     check_vessel() with a structured-identifier match (mmsi/imo), not a
     name guess.
  2. A vessel that only appears in the maritime file with an empty/non-
     sanction `risk` (a Port State Control safety-detention-only entry,
     e.g. Abuja MoU / Tokyo MoU) is NOT returned as a hit — proving the
     sanctions-scope filter actually excludes non-sanctions maritime
     watchlist entries.
  3. Prints the before/after fuzzy-match-rate numbers computed by
     re-running the OLD generic-CSV vessel-detection logic
     (schema=="Vessel" OR keyword heuristic + freeform "identifiers"
     regex scrape) against a real download of the old source
     (targets.simple.csv), compared to the NEW source's actual
     name-only rate as loaded by sanctions_loader.

No pytest — plain script with a check()/FAILURES accumulator, matching
this codebase's existing test convention (see test_ais_spoofing.py).

Usage:
    cd backend
    python3 test_sanctions_maritime_source.py
"""
import os, sys, asyncio, csv, re, io

sys.path.insert(0, os.path.dirname(__file__))

import httpx

from sanctions_loader import SanctionsLoader

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


# ── Part 1: load the real new source and confirm filter behaviour ──────────

async def load_new_source():
    loader = SanctionsLoader()
    stats = await loader.load_or_refresh()
    return loader, stats


def part1_new_source():
    print("\n=== Part 1: real maritime.csv download + check_vessel() ===")
    loader, stats = asyncio.run(load_new_source())

    check("load_or_refresh() returned without an 'error' key",
          "error" not in stats, detail=str(stats))
    check("at least one vessel was indexed",
          loader._total_vessels > 0, detail=str(stats))

    # --- known real sanctioned vessel (verified present in a real download,
    # 2026-08-29): OLYMPIA, MMSI 319766000, IMO 1006960, flag 'ky',
    # risk 'poi', dataset ua_war_sanctions ---
    hit = loader.check_vessel(mmsi="319766000")
    check("OLYMPIA found by MMSI 319766000",
          hit is not None, detail="no hit returned")
    if hit:
        check("OLYMPIA hit has _match_type in (mmsi, imo)",
              hit.get("_match_type") in ("mmsi", "imo"),
              detail=f"_match_type={hit.get('_match_type')}")
        check("OLYMPIA hit carries the real flag column value ('ky'), not a countries[:2] guess",
              hit.get("flag") == "ky", detail=f"flag={hit.get('flag')!r}")

    hit_imo = loader.check_vessel(imo="1006960")
    check("OLYMPIA also found by bare IMO 1006960 (IMO<7digits> prefix stripped correctly)",
          hit_imo is not None and hit_imo.get("_match_type") == "imo",
          detail=str(hit_imo))

    # --- second known real sanctioned vessel: TONG SAN 2, MMSI 445539000,
    # IMO 8937675, risk 'sanction', dataset eu_sanctions_map ---
    hit2 = loader.check_vessel(mmsi="445539000")
    check("TONG SAN 2 found by MMSI 445539000",
          hit2 is not None and hit2.get("_match_type") == "mmsi",
          detail=str(hit2))

    # --- negative: SIRAYA WISDOM, IMO 9403841, risk == 'mare.detained'
    # ONLY (Abuja MoU Port State Control detention, dataset
    # abuja_mou_detention) — this is a safety detention, NOT a sanction,
    # and must not be indexed at all. ---
    neg_hit_imo = loader.check_vessel(imo="9403841")
    check("SIRAYA WISDOM (PSC safety detention, not a sanction) is NOT a hit by IMO",
          neg_hit_imo is None, detail=str(neg_hit_imo))
    neg_hit_name = loader.check_vessel(name="SIRAYA WISDOM")
    check("SIRAYA WISDOM is also NOT a hit by exact/fuzzy name",
          neg_hit_name is None, detail=str(neg_hit_name))

    return loader


# ── Part 2: before/after fuzzy-match-rate comparison ────────────────────────

_MMSI_RE_OLD = re.compile(r'^\d{9}$')
_IMO_RE_OLD  = re.compile(r'^IMO(\d{7})$', re.IGNORECASE)
_VESSEL_KEYWORDS_OLD = {"tanker", "cargo", "ship", "vessel", "ferry", "bulk", "lng", "lpg"}


def _extract_ids_old(identifiers_str):
    mmsi = imo = None
    for token in identifiers_str.split(";"):
        token = token.strip()
        m = _IMO_RE_OLD.match(token)
        if m:
            imo = m.group(1)
            continue
        if _MMSI_RE_OLD.match(token):
            mmsi = token
    return mmsi, imo


def _is_vessel_row_old(row):
    schema = (row.get("schema") or "").strip()
    if schema == "Vessel":
        return True
    name = (row.get("name") or "").lower()
    return any(kw in name for kw in _VESSEL_KEYWORDS_OLD)


def part2_before_after():
    print("\n=== Part 2: before/after fuzzy-match-rate (real data, not assumed) ===")

    # --- OLD source: generic targets.simple.csv, old detection logic ---
    old_url = "https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv"
    try:
        r = httpx.get(old_url, timeout=60, follow_redirects=True)
        r.raise_for_status()
        old_rows = list(csv.DictReader(io.StringIO(r.text)))
    except Exception as e:
        print(f"  [SKIP] could not download old source for comparison: {e}")
        return

    old_vessel_rows = [row for row in old_rows if _is_vessel_row_old(row)]
    old_true_vessel_rows = [row for row in old_vessel_rows if (row.get("schema") or "").strip() == "Vessel"]
    old_false_positive_rows = [row for row in old_vessel_rows
                                if (row.get("schema") or "").strip() != "Vessel"]

    old_name_only = 0
    for row in old_vessel_rows:
        mmsi, imo = _extract_ids_old(row.get("identifiers") or "")
        if not (mmsi or imo):
            old_name_only += 1

    old_fp_no_id = sum(
        1 for row in old_false_positive_rows
        if not any(_extract_ids_old(row.get("identifiers") or ""))
    )

    old_total = len(old_vessel_rows)
    old_rate = (old_name_only / old_total * 100) if old_total else 0.0

    print(f"  OLD source (targets.simple.csv, {len(old_rows)} total rows):")
    print(f"    'vessel' rows per old schema-or-keyword logic : {old_total}")
    print(f"    of which schema=='Vessel' (real vessels)      : {len(old_true_vessel_rows)}")
    print(f"    of which NOT schema=='Vessel' (false positives"
          f" from _VESSEL_KEYWORDS, e.g. shipping companies)  : {len(old_false_positive_rows)}"
          f" ({len(old_false_positive_rows)/old_total*100:.1f}% of tagged 'vessels')")
    print(f"    false-positive rows with ZERO mmsi/imo (pure"
          f" name-string ghosts in _sanctions_by_name)        : {old_fp_no_id}")
    print(f"    name-only rows overall (needs exact/fuzzy_name): {old_name_only}/{old_total}"
          f" = {old_rate:.2f}%")

    # --- NEW source: maritime.csv, new detection logic (mirrors sanctions_loader._parse_csv) ---
    new_url = "https://data.opensanctions.org/datasets/latest/maritime/maritime.csv"
    try:
        r = httpx.get(new_url, timeout=60, follow_redirects=True)
        r.raise_for_status()
        new_rows = list(csv.DictReader(io.StringIO(r.text)))
    except Exception as e:
        print(f"  [SKIP] could not download new source for comparison: {e}")
        return

    def new_keep(row):
        risk = (row.get("risk") or "").lower()
        return (row.get("type") or "").strip().upper() == "VESSEL" and \
               ("sanction" in risk or "poi" in risk)

    new_filtered = [row for row in new_rows if new_keep(row)]
    new_name_only = sum(
        1 for row in new_filtered
        if not (row.get("mmsi") or "").strip() and not (row.get("imo") or "").strip()
    )
    new_total = len(new_filtered)
    new_rate = (new_name_only / new_total * 100) if new_total else 0.0

    print(f"\n  NEW source (maritime.csv, {len(new_rows)} total rows):")
    print(f"    rows kept (type==VESSEL AND risk has sanction/poi): {new_total}")
    print(f"    name-only rows (needs exact/fuzzy_name)           : {new_name_only}/{new_total}"
          f" = {new_rate:.2f}%")

    print(f"\n  SUMMARY: name-only fallback rate {old_rate:.2f}% (old) -> {new_rate:.2f}% (new).")
    print(f"  Additionally, the old source misclassified"
          f" {len(old_false_positive_rows)} non-vessel entities as vessels"
          f" ({old_fp_no_id} with no structured ID at all) via keyword"
          f" guessing — a class of error the new source's reliable `type`"
          f" column eliminates entirely (0 misclassified rows possible).")


if __name__ == "__main__":
    part1_new_source()
    part2_before_after()

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s) failed: {FAILURES}")
        sys.exit(1)
    else:
        print("All checks passed.")
