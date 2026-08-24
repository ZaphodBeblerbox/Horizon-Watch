"""
ingest_pilot_assets.py — Load a small, individually-researched Asset pilot
set for the Red Sea / Bab-el-Mandeb AOI into the real Asset registry.

Every row below was verified against a live source just before this file was
written (see each entry's citation) — this is not a training-data guess at
"who owns this port." Where the current operational status is genuinely
contested or evolving (Doraleh's DP World/Djibouti dispute, Assab's reported
2025 UAE drawdown), the description says so plainly and confidence is set to
"inferred" rather than overclaiming certainty a single source doesn't support.

Idempotent: skips any (name, region_tag) pair that's already in the registry,
so running this twice is harmless.

Usage:
    cd backend
    python3 ingest_pilot_assets.py
"""
import os, sys
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient
import main

REGION = "red_sea_bab_el_mandeb"

ASSETS = [
    {
        "name": "Doraleh Container Terminal", "asset_type": "port", "category": "civilian",
        "owner": "Government of Djibouti (via state-owned Doraleh Container Terminal Management Company)",
        "operator": "Doraleh Container Terminal Management Company",
        "country": "Djibouti", "lat": 11.63, "lng": 43.08, "region_tag": REGION,
        "confidence": "direct",
        "description": (
            "Djibouti's main container terminal. Ownership has been disputed since the "
            "government seized it from DP World in February 2018; London courts have "
            "repeatedly ruled the seizure illegal (DP World says it has won seven such "
            "rulings, including a January 2020 award of $533M in compensation), but Djibouti "
            "has not returned control and continues to operate it as state-owned."
        ),
        "source_title": "Port of Doraleh", "source_publisher": "Wikipedia",
        "source_url": "https://en.wikipedia.org/wiki/Port_of_Doraleh",
        "source_excerpt": (
            "In February 2018, on the order of president Ismail Omar Guelleh, the Djibouti "
            "government seized the facility and placed it under the control of the "
            "government-owned Doraleh Container Terminal Management Company. ... According to "
            "DP World, all rulings have been ignored by Djibouti."
        ),
    },
    {
        "name": "Camp Lemonnier", "asset_type": "naval_base", "category": "military",
        "owner": "Government of Djibouti (host-nation lease)",
        "operator": "U.S. Navy Region Europe, Africa, Central — home to AFRICOM's Combined Joint Task Force – Horn of Africa",
        "country": "Djibouti", "lat": 11.545, "lng": 43.159, "region_tag": REGION,
        "confidence": "direct",
        "description": "The only permanent US military base in Africa; a United States Naval Expeditionary Base next to Djibouti–Ambouli International Airport.",
        "source_title": "Camp Lemonnier", "source_publisher": "Wikipedia",
        "source_url": "https://en.wikipedia.org/wiki/Camp_Lemonnier",
        "source_excerpt": (
            "The camp is operated by U.S. Navy Region Europe, Africa, Central. Camp Lemonnier "
            "is a United States Naval Expeditionary Base ... and home to the Combined Joint "
            "Task Force – Horn of Africa (CJTF-HOA) of the U.S. Africa Command (AFRICOM)."
        ),
    },
    {
        "name": "Assab Port", "asset_type": "port", "category": "dual_use",
        "owner": "Government of Eritrea",
        "operator": "Government of Eritrea (port); United Arab Emirates established a military/logistics presence 2015-2021, reportedly scaled back since",
        "country": "Eritrea", "lat": 13.0, "lng": 42.74, "region_tag": REGION,
        "confidence": "inferred",
        "description": (
            "Commercial Eritrean Red Sea port that the UAE built into a major military and "
            "logistics hub (airstrips, hangars, supply facilities) supporting its role in the "
            "Yemen war, roughly 2015-2021. One November 2025 analysis reports the UAE "
            "subsequently scaled back its Yemen operations and withdrew from Assab — current "
            "operational military status is not independently confirmed here, hence 'inferred'."
        ),
        "source_title": "Foreign Military Presence and Eritrea's Calculus in the Red Sea",
        "source_publisher": "Horn Review", "source_date": "2025-11-06",
        "source_url": "https://hornreview.org/2025/11/06/foreign-military-presence-and-eritreas-calculus-in-the-red-sea/",
        "source_excerpt": (
            "the UAE established a significant military and logistical presence at Assab Port, "
            "which became a key operational hub for its involvement in the Yemen conflict ... "
            "major expansions of infrastructure, including airstrips, hangars, and supply "
            "facilities ... the UAE subsequently scaled back its Yemen operations and withdrew "
            "from Assab."
        ),
    },
    {
        "name": "Berbera Port", "asset_type": "port", "category": "civilian",
        "owner": "DP World (51%), Government of Somaliland (30%), Ethiopia (19%)",
        "operator": "DP World",
        "country": "Somaliland", "lat": 10.43, "lng": 45.02, "region_tag": REGION,
        "confidence": "direct",
        "description": "Major Gulf of Aden commercial port under a 30-year DP World concession; Ethiopia holds an equity stake for Red Sea trade-corridor access.",
        "source_title": "Ethiopia to buy 19% stake in DP World's Berbera Port in Somaliland",
        "source_publisher": "Ship Technology", "source_date": "2018-03-02",
        "source_url": "https://www.ship-technology.com/news/ethiopia-buy-19-stake-dp-worlds-berbera-port-somaliland/",
        "source_excerpt": "DP World will own a 51% stake in the port following the completion of the deal, while Somaliland and Ethiopia will hold shares of 30% and 19% respectively.",
    },
    {
        "name": "Hodeidah Port", "asset_type": "port", "category": "dual_use",
        "owner": "Yemeni state port authority (nominal)",
        "operator": "De facto controlled by Houthi (Ansar Allah) forces",
        "country": "Yemen", "lat": 14.80, "lng": 42.95, "region_tag": REGION,
        "confidence": "direct",
        "description": "Yemen's principal Red Sea port; a critical humanitarian and commercial import point that the Houthi movement controls and has used for military leverage, drawing repeated coalition strikes on facilities there.",
        "source_title": "Mapping who controls what in Yemen in 2026", "source_publisher": "Al Jazeera",
        "source_date": "2026-01-14",
        "source_url": "https://www.aljazeera.com/news/2026/1/14/mapping-who-controls-what-in-yemen-in-2026",
        "source_excerpt": "[The Houthis] control several strategic locations along the Red Sea, including the key port of Hodeidah.",
    },
    {
        "name": "Port of Aden", "asset_type": "port", "category": "civilian",
        "owner": "Yemeni state port authority",
        "operator": "Aden Container Terminal / Aden Ports and Development Company (APDC), under the nominal authority of Yemen's Internationally Recognized Government",
        "country": "Yemen", "lat": 12.78, "lng": 45.03, "region_tag": REGION,
        "confidence": "direct",
        "description": "Yemen's main southern commercial port and the seat of the Internationally Recognized Government; government control of the city is contested in parts with STC (Southern Transitional Council) forces.",
        "source_title": "Mapping who controls what in Yemen in 2026", "source_publisher": "Al Jazeera",
        "source_date": "2026-01-14",
        "source_url": "https://www.aljazeera.com/news/2026/1/14/mapping-who-controls-what-in-yemen-in-2026",
        "source_excerpt": "the government claims to have control of Aden and other parts of southern Yemen, but STC forces remain in some areas.",
    },
]


def main_ingest():
    print("="*70)
    print("  Pilot Asset ingestion — Red Sea / Bab-el-Mandeb AOI")
    print("="*70)
    headers = {"X-Forge-Passcode": main._FORGE_PASSCODE}
    with TestClient(main.app) as client:
        existing = client.get("/api/forge/assets", params={"region_tag": REGION}, headers=headers).json()
        existing_names = {a["name"] for a in existing}
        created = skipped = 0
        for a in ASSETS:
            if a["name"] in existing_names:
                print(f"  [skip] already exists: {a['name']}")
                skipped += 1
                continue
            r = client.post("/api/forge/assets", json=a, headers=headers)
            if r.status_code == 200:
                print(f"  [ok]   created: {a['name']} ({r.json()['asset_id']})")
                created += 1
            else:
                print(f"  [FAIL] {a['name']}: {r.status_code} {r.text[:200]}")
        print("="*70)
        print(f"  {created} created, {skipped} already present, {len(ASSETS)} total in pilot set")
        print("="*70)


if __name__ == "__main__":
    main_ingest()
