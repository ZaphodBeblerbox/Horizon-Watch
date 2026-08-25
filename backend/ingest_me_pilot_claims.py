"""
One-time ingestion of the Middle East convergence-engine pilot corpus into the
Forge ontology claims review queue.

Source: claude/Horizon_Watch_ME_Pilot_Source_Manifest.md (Section 2 — Draft
Entity & Relationship Candidates), itself built from 98 real, fetched, dated
documents (Section 1 of that manifest). Every claim below carries the same
citation fields the manifest lists for that row, plus a short evidence excerpt
pulled from the manifest's own recorded facts for that source — nothing here
is freehand model recall, it is this session's own already-cited research
re-expressed in the claim schema.

This submits all 42 candidate rows via POST /api/forge/ontology/claims/bulk.
They land as status="pending" — this script does NOT approve any of them.
A human (Marc) reviews each one's citation via GET /api/forge/ontology/claims
and approves or rejects individually; that is the entire point of the review
gate this pipeline was built around.

Usage:
    cd backend
    python3 ingest_me_pilot_claims.py
"""
import os, sys
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient

MANIFEST_DOC = "claude/Horizon_Watch_ME_Pilot_Source_Manifest.md (project doc)"


def _get_admin_auth_headers() -> dict:
    """Forge is admin-gated (require_admin_user), not passcode-gated. Use a real
    existing admin account if one is in this DB already; otherwise bootstrap a
    minimal one so this script still works against a fresh/empty database."""
    from database import get_db, User
    from app_shared import make_jwt
    with get_db() as db:
        admin = db.query(User).filter((User.role == "admin") | (User.is_super_admin == True)).first()
        if admin is None:
            admin = User(id="PILOT-INGEST-ADMIN", email="pilot-ingest-admin@test.local",
                         password_hash="not-used", role="admin", approved=True)
            db.add(admin)
            db.commit()
        admin_id = admin.id
    return {"Authorization": f"Bearer {make_jwt(admin_id)}"}

CLAIMS = [
    dict(entity_a="IRGC-Quds Force", entity_a_type="organization", relationship_type="commands",
         entity_b="Hezbollah", entity_b_type="group", as_of="Aug 2026", confidence="direct",
         source_title="Treasury Increases Sanctions on Hizballah...Smuggling Millions in Cash for Hizballah",
         source_publisher="U.S. Department of the Treasury", source_date="2026-08-20",
         source_url="https://home.treasury.gov/news/press-releases/sb0611",
         evidence="Treasury's Aug 20, 2026 designation re-affirms Hezbollah as \"operating under the command of Iran's Islamic Revolutionary Guard Corps-Qods Force\" and as an entity \"owned, controlled, or directed by\" the IRGC-QF."),
    dict(entity_a="Iran", entity_a_type="country", relationship_type="arms",
         entity_b="Houthis (Ansar Allah)", entity_b_type="group", as_of="2024-2026", confidence="direct",
         source_title="Yemen: Conflict, Red Sea Security, and U.S. Policy (CRS IF12581)",
         source_publisher="Congressional Research Service", source_date="2026-07-21",
         source_url="https://www.everycrsreport.com/reports/IF12581.html",
         evidence="\"Iran has supplied the Houthis with weaponry, targeting information, and military advice\" per U.S. officials; by July 2026, Iran-to-Sana'a flights preceded infrastructure strikes."),
    dict(entity_a="Iran", entity_a_type="country", relationship_type="funds",
         entity_b="Hamas", entity_b_type="group", as_of="2021-2024 est.", confidence="direct",
         source_title="Iran-Supported Groups in the Middle East and U.S. Policy (CRS IF12587)",
         source_publisher="Congressional Research Service", source_date="2024-09-26",
         source_url="https://www.everycrsreport.com/reports/IF12587.html",
         evidence="Iran provides \"up to $100 million annually in combined support to Palestinian terrorist groups, including Hamas.\""),
    dict(entity_a="IRGC-Quds Force", entity_a_type="organization", relationship_type="directs",
         entity_b="Kata'ib Hezbollah", entity_b_type="group", as_of="2024", confidence="direct",
         source_title="Iran-Supported Groups in the Middle East and U.S. Policy (CRS IF12587)",
         source_publisher="Congressional Research Service", source_date="2024-09-26",
         source_url="https://www.everycrsreport.com/reports/IF12587.html",
         evidence="Names Kata'ib Hezbollah, Harakat al-Nujaba, and Asa'ib Ahl al-Haq as the key Iran-backed Iraqi militias, all U.S.-designated FTOs."),
    dict(entity_a="UAE", entity_a_type="country", relationship_type="funds",
         entity_b="Security Belt Forces (Yemen)", entity_b_type="group", as_of="2016-2022", confidence="direct",
         source_title="Yemen: UAE Backs Abusive Local Forces",
         source_publisher="Human Rights Watch", source_date="2017-06-22",
         source_url="https://www.hrw.org/news/2017/06/22/yemen-uae-backs-abusive-local-forces",
         evidence="Security Belt Forces — created spring 2016, operates in Aden/Lahj/Abyan — \"funded, trained, and directed by the UAE.\""),
    dict(entity_a="UAE", entity_a_type="country", relationship_type="funds",
         entity_b="Hadhrami Elite Forces (Yemen)", entity_b_type="group", as_of="2016-2022", confidence="direct",
         source_title="Yemen: UAE Backs Abusive Local Forces",
         source_publisher="Human Rights Watch", source_date="2017-06-22",
         source_url="https://www.hrw.org/news/2017/06/22/yemen-uae-backs-abusive-local-forces",
         evidence="Hadhrami Elite Forces — nominally Yemen Army 2nd Military Zone but under effective UAE operational control."),
    dict(entity_a="UAE", entity_a_type="country", relationship_type="allied_with",
         entity_b="Southern Transitional Council (STC)", entity_b_type="group", as_of="2017-2026", confidence="direct",
         source_title="The Strategic Costs of Saudi-Emirati Competition",
         source_publisher="Gulf International Forum", source_date="2026-02-16",
         source_url="https://gulfif.org/the-strategic-costs-of-saudi-emirati-competition/",
         evidence="The UAE withdrew from Yemen front lines after roughly four years and shifted backing to the Southern Transitional Council (STC, established 2017); STC captured Mahra and Hadramawt in December 2025."),
    dict(entity_a="UAE", entity_a_type="country", relationship_type="sponsors",
         entity_b="Rapid Support Forces (RSF, Sudan)", entity_b_type="group", as_of="2023-2026", confidence="direct",
         source_title="Divided Sudan, Elusive Peace (Briefing 211)",
         source_publisher="International Crisis Group", source_date="2026-04-13",
         source_url="https://www.crisisgroup.org/brf/africa/sudan-egypt-saudi-arabia-united-arab-emirates-united-states/b211-divided-sudan-elusive-peace",
         evidence="Identifies the UAE as the RSF's \"primary patron\" since 2023, providing \"financial, military and logistical support,\" with arms routed through Amdjarass/Abéché, Chad, later diversified through southern Libya."),
    dict(entity_a="Saudi Arabia", entity_a_type="country", relationship_type="backs",
         entity_b="Sudanese Armed Forces (SAF)", entity_b_type="group", as_of="2023-2026", confidence="direct",
         source_title="The Strategic Costs of Saudi-Emirati Competition",
         source_publisher="Gulf International Forum", source_date="2026-02-16",
         source_url="https://gulfif.org/the-strategic-costs-of-saudi-emirati-competition/",
         evidence="In Sudan, Saudi Arabia backs the Sudanese Armed Forces (SAF) under Gen. Abdel Fattah al-Burhan, while the UAE backs the RSF under Gen. Mohamed Hamdan Dagalo (\"Hemedti\")."),
    dict(entity_a="UAE", entity_a_type="country", relationship_type="funded",
         entity_b="Khalifa Haftar / Libyan National Army (LNA)", entity_b_type="group", as_of="2019-2021", confidence="direct",
         source_title="Final Report of the Panel of Experts on Libya (S/2021/229)",
         source_publisher="UN Security Council 1970 Sanctions Committee", source_date="2021-03-08",
         source_url="https://main.un.org/securitycouncil/en/sanctions/1970/panel-experts/reports",
         evidence="Documents a Jan 19, 2020 five-aircraft weapons delivery to Libya breaching the UN arms embargo, four of five aircraft UAE-registered; Erik Prince's ~$80M mercenary/weapons operation for Haftar was most likely UAE-funded per Western officials."),
    dict(entity_a="DP World", entity_a_type="organization", relationship_type="operates",
         entity_b="Berbera Port, Somaliland", entity_b_type="port", as_of="2024", confidence="direct",
         source_title="The Stakes in the Ethiopia-Somaliland Deal",
         source_publisher="International Crisis Group", source_date="2024-03-06",
         source_url="https://www.crisisgroup.org/qna/africa/ethiopia/stakes-ethiopia-somaliland-deal",
         evidence="DP World (Dubai state-owned) is investing $442 million for a majority stake in Berbera port."),
    dict(entity_a="DP World", entity_a_type="organization", relationship_type="operates",
         entity_b="Tartous Port, Syria", entity_b_type="port", as_of="2025-01", confidence="direct",
         source_title="Does Russia Still Matter in Syria?",
         source_publisher="International Crisis Group", source_date="2026-07-07",
         source_url="https://www.crisisgroup.org/cmt/middle-east-north-africa/syria-russia/does-russia-still-matter-syria",
         evidence="In January 2025 Syria canceled the Stroytransgaz Tartous port concession and awarded DP World (UAE) an $800M, 30-year redevelopment contract."),
    dict(entity_a="Naim Qassem", entity_a_type="person", relationship_type="leads",
         entity_b="Hezbollah", entity_b_type="group", as_of="since Oct 2024", confidence="direct",
         source_title="Lebanese Hezbollah (CRS IF10703)",
         source_publisher="Congressional Research Service", source_date="2024-12-04",
         source_url="https://www.everycrsreport.com/reports/IF10703.html",
         evidence="Naim Qassem was selected by Hezbollah's Shura Council in October 2024 to succeed Hassan Nasrallah, who was killed by an Israeli airstrike in September 2024."),
    dict(entity_a="Nabih Berri", entity_a_type="person", relationship_type="leads",
         entity_b="Amal Movement", entity_b_type="group", as_of="ongoing (32+ yrs)", confidence="direct",
         source_title="Israel and Lebanon's Hesitant Steps on the Long Road to Peace",
         source_publisher="The Washington Institute for Near East Policy", source_date="2026-08-12",
         source_url="https://www.washingtoninstitute.org/policy-analysis/israel-and-lebanons-hesitant-steps-long-road-peace",
         evidence="Names Speaker Nabih Berri as a Hezbollah ally and leader of the Amal Movement."),
    dict(entity_a="Nabih Berri", entity_a_type="person", relationship_type="holds_office",
         entity_b="Speaker of the Lebanese Parliament", entity_b_type="facility", as_of="since 1992", confidence="direct",
         source_title="Qmati says Hezbollah open to talks with US...",
         source_publisher="Naharnet", source_date="2026-08-23",
         source_url="https://www.naharnet.com/stories/en/322021-qmati-says-hezbollah-open-to-talks-with-us-studying-all-options-as-to-ali-al-taher",
         evidence="Confirms Nabih Berri's current title, Speaker of Parliament, as of August 2026."),
    dict(entity_a="Hezbollah", entity_a_type="group", relationship_type="adversarial_to",
         entity_b="Lebanese Armed Forces (LAF)", entity_b_type="group", as_of="2026 (assessed)", confidence="inferred",
         source_title="Hizballah's Deep State: The Real Challenge of Disarmament in Lebanon",
         source_publisher="The Washington Institute for Near East Policy", source_date="2026-07-15",
         source_url="https://www.washingtoninstitute.org/policy-analysis/hizballahs-deep-state-real-challenge-disarmament-lebanon",
         evidence="The LAF is described as \"infiltrated by Hizballah operatives, who share intelligence with the group and hinder the process of disarmament.\""),
    dict(entity_a="Abdul-Malik al-Houthi", entity_a_type="person", relationship_type="leads",
         entity_b="Ansar Allah (Houthi movement)", entity_b_type="group", as_of="2026", confidence="direct",
         source_title="The Houthis' Second Generation Dilemma",
         source_publisher="Sana'a Center for Strategic Studies", source_date="2026-07-31",
         source_url="https://sanaacenter.org/the-yemen-review/april-june-2026/28082",
         evidence="Abdul-Malik al-Houthi leads the movement and \"directly supervised\" the Revolutionary Security Service, the group's highest internal security agency."),
    dict(entity_a="Mohammed al-Ghamari", entity_a_type="person", relationship_type="held_office",
         entity_b="Chief of Staff, Houthi armed forces", entity_b_type="facility", as_of="designated 2021, killed Aug 2025", confidence="direct",
         source_title="OFAC Recent Action, May 20, 2021",
         source_publisher="U.S. Department of the Treasury / OFAC", source_date="2021-05-20",
         source_url="https://ofac.treasury.gov/recent-actions/20210520_33",
         evidence="Designated Muhammad Abd Al-Karim Al-Ghamari as a senior Houthi military official overseeing offensive operations; the Sana'a Center (Jul 2026) independently confirms this is the same Mohammed al-Ghamari who rose to Chief of Staff and was killed by an Israeli airstrike in August 2025."),
    dict(entity_a="Ahmad al-Sharaa", entity_a_type="person", relationship_type="leads",
         entity_b="Syria (transitional government)", entity_b_type="country", as_of="since Dec 2024", confidence="direct",
         source_title="Trouble Is Brewing in Syria",
         source_publisher="International Crisis Group", source_date="2026-02-04",
         source_url="https://www.crisisgroup.org/opd/middle-east-north-africa/syria/trouble-brewing-syria",
         evidence="Ahmed al-Sharaa (former HTS leader) toppled the Assad regime in December 2024; HTS formally dissolved in January 2025."),
    dict(entity_a="Mazloum Abdi", entity_a_type="person", relationship_type="commands",
         entity_b="Syrian Democratic Forces (SDF)", entity_b_type="group", as_of="ongoing", confidence="direct",
         source_title="Lead IG Quarterly Report to Congress, Operation Inherent Resolve (Q2 CY2026)",
         source_publisher="DoD Office of Inspector General", source_date="2026-05-28",
         source_url="https://media.defense.gov/2026/May/28/2003941098/-1/-1/1/LEAD_IG_OIR_Q2_FINAL_REPORT_REVISED%205.28.PDF",
         evidence="Names SDF commander Mazloum Abdi; documents the SDF's integration into Syrian government security structures per the Jan 29, 2026 agreement."),
    dict(entity_a="Syrian Democratic Forces (SDF)", entity_a_type="group", relationship_type="member_of",
         entity_b="Syrian government security structures", entity_b_type="organization", as_of="Jan 2026-", confidence="direct",
         source_title="Syria and U.S. Policy (CRS IF11930)",
         source_publisher="Congressional Research Service", source_date="2026-06-11",
         source_url="https://www.everycrsreport.com/reports/IF11930.html",
         evidence="Following a January 2026 integration agreement, elements of the SDF were absorbed into Syria's state security bodies."),
    dict(entity_a="United States", entity_a_type="country", relationship_type="withdrew_from",
         entity_b="Syria (military presence)", entity_b_type="country", as_of="Apr 2026", confidence="direct",
         source_title="Syria and U.S. Policy (CRS IF11930)",
         source_publisher="Congressional Research Service", source_date="2026-06-11",
         source_url="https://www.everycrsreport.com/reports/IF11930.html",
         evidence="US forces completed an \"accelerated departure\" from Syria in April 2026, ending an ~11-year Operation Inherent Resolve presence that began in 2015."),
    dict(entity_a="US NAVCENT / 5th Fleet", entity_a_type="organization", relationship_type="headquartered_at",
         entity_b="Manama, Bahrain", entity_b_type="facility", as_of="ongoing", confidence="direct",
         source_title="Component Commands page",
         source_publisher="U.S. Central Command", source_date="2026",
         source_url="https://www.centcom.mil/ABOUT-US/COMPONENT-COMMANDS/",
         evidence="US Naval Forces Central Command (NAVCENT), home of the US Fifth Fleet, is headquartered in Manama, Bahrain."),
    dict(entity_a="US 379th Air Expeditionary Wing", entity_a_type="organization", relationship_type="based_at",
         entity_b="Al Udeid Air Base, Qatar", entity_b_type="facility", as_of="ongoing", confidence="direct",
         source_title="379th Air Expeditionary Wing (unit page)",
         source_publisher="US Air Forces Central Command (AFCENT)", source_date="2026",
         source_url="https://www.afcent.af.mil/Units/379th-Air-Expeditionary-Wing/",
         evidence="Confirms base location: Al Udeid Air Base, Qatar — \"the largest, most diverse expeditionary wing in the Air Force.\""),
    dict(entity_a="US 378th Air Expeditionary Wing", entity_a_type="organization", relationship_type="based_at",
         entity_b="Prince Sultan Air Base, Saudi Arabia", entity_b_type="facility", as_of="ongoing", confidence="direct",
         source_title="378th Air Expeditionary Wing Fact Sheet",
         source_publisher="US Air Forces Central Command (AFCENT)", source_date="2026",
         source_url="https://www.afcent.af.mil/Units/378th-Air-Expeditionary-Wing/Fact-Sheet/",
         evidence="\"The 378th AEW projects combat airpower in concert with our coalition partners, defends Prince Sultan Air Base...\""),
    dict(entity_a="United States", entity_a_type="country", relationship_type="funds",
         entity_b="Lebanese Armed Forces (LAF)", entity_b_type="group", as_of="2006-2026", confidence="direct",
         source_title="Lebanon (CRS IF11617)",
         source_publisher="Congressional Research Service", source_date="2026-07-20",
         source_url="https://www.everycrsreport.com/reports/IF11617.html",
         evidence="The US has provided $3 billion in Foreign Military Financing to the LAF since 2006, plus over $3.5 billion in humanitarian aid since FY2019."),
    dict(entity_a="Strait of Hormuz", entity_a_type="facility", relationship_type="chokepoint_for",
         entity_b="global oil trade", entity_b_type="event", as_of="2022 baseline", confidence="direct",
         source_title="The Strait of Hormuz is the world's most important oil transit chokepoint",
         source_publisher="U.S. Energy Information Administration (EIA)", source_date="2023-11-21",
         source_url="https://www.eia.gov/todayinenergy/detail.php?id=61002",
         evidence="~21 million b/d transited the Strait in 2022, roughly 21% of global petroleum liquids consumption and more than a quarter of seaborne-traded oil."),
    dict(entity_a="Bab-el-Mandeb Strait", entity_a_type="facility", relationship_type="chokepoint_for",
         entity_b="Red Sea shipping", entity_b_type="event", as_of="2023-2024", confidence="direct",
         source_title="Fewer tankers transit the Red Sea in 2024",
         source_publisher="U.S. Energy Information Administration (EIA)", source_date="2024-10-11",
         source_url="https://www.eia.gov/todayinenergy/detail.php?id=63446",
         evidence="Bab el-Mandeb oil flow fell from 8.7 million b/d (2023) to 4.0 million b/d (Jan-Aug 2024), a drop of more than 50% following Houthi attacks on shipping beginning November 2023."),
    dict(entity_a="United States", entity_a_type="country", relationship_type="hosts",
         entity_b="Camp Lemonnier, Djibouti", entity_b_type="facility", as_of="since ~2002, $63M/yr lease renewed 2014", confidence="direct",
         source_title="Djibouti (CRS IF11303)",
         source_publisher="Congressional Research Service", source_date="2025-06-09",
         source_url="https://www.everycrsreport.com/reports/IF11303.html",
         evidence="Camp Lemonnier is described as \"the only enduring U.S. military installation in Africa,\" hosting 5,000+ personnel under a 20-year lease renewed in 2014 at $63 million/year."),
    dict(entity_a="China", entity_a_type="country", relationship_type="operates",
         entity_b="China's first overseas military base, Djibouti", entity_b_type="facility", as_of="since 2017", confidence="direct",
         source_title="AFRICOM: Chinese Naval Base in Africa Set to Support Aircraft Carriers",
         source_publisher="USNI News", source_date="2021-04-20",
         source_url="https://news.usni.org/2021/04/20/africom-chinese-naval-base-in-africa-set-to-support-aircraft-carriers",
         evidence="AFRICOM Commander Gen. Stephen Townsend testified to Congress that this is China's \"first overseas military base, their only one.\""),
    dict(entity_a="Adani Ports / Gadot Group", entity_a_type="organization", relationship_type="operates",
         entity_b="Haifa Port, Israel", entity_b_type="port", as_of="since 2022, concession to 2054", confidence="direct",
         source_title="Adani and Gadot win tender to privatise Israel's Haifa Port",
         source_publisher="Adani Ports and Special Economic Zone Ltd. (APSEZ)", source_date="2022-07-15",
         source_url="https://www.adaniports.com/newsroom/media-releases/adani-and-gadot-win-tender-to-privatise-israels-haifa-port",
         evidence="Consortium of APSEZ (70%) and Gadot Group (30%), deal value NIS 4.1 billion (~$1.18 billion), concession through 2054; port handles ~50% of Israel's container cargo."),
    dict(entity_a="China Overseas Port Holding Company", entity_a_type="organization", relationship_type="operates",
         entity_b="Gwadar Port, Pakistan", entity_b_type="port", as_of="since 2017 agreement, 40-yr BOT", confidence="direct",
         source_title="China to get 91pc Gwadar income, minister tells Senate",
         source_publisher="Dawn", source_date="2017-11-25",
         source_url="https://www.dawn.com/news/1372695",
         evidence="China Overseas Port Holding Company receives 91% of Gwadar Port revenue under a 40-year build-operate-transfer agreement; the Gwadar Port Authority (Pakistan) gets 9%."),
    dict(entity_a="United Kingdom", entity_a_type="country", relationship_type="operates",
         entity_b="Duqm logistics base, Oman", entity_b_type="facility", as_of="since 2018", confidence="direct",
         source_title="Defence Secretary announces investment in strategic Omani port",
         source_publisher="UK Ministry of Defence", source_date="2020-09-12",
         source_url="https://www.gov.uk/government/news/defence-secretary-announces-investment-in-strategic-omani-port",
         evidence="An additional £23.8 million investment to triple the size of the UK logistics base at Duqm, whose dry dock is able to support HMS Queen Elizabeth and HMS Prince of Wales."),
    dict(entity_a="Hamas", entity_a_type="group", relationship_type="hosted_by",
         entity_b="Qatar", entity_b_type="country", as_of="ongoing", confidence="direct",
         source_title="What Is Hamas?",
         source_publisher="Council on Foreign Relations", source_date="2025-10-06",
         source_url="https://www.cfr.org/backgrounder/what-hamas",
         evidence="Qatar hosts Hamas's political office and provides \"hundreds of millions\" in annual assistance."),
    dict(entity_a="Khalil al-Hayya", entity_a_type="person", relationship_type="leads",
         entity_b="Hamas", entity_b_type="group", as_of="2024-2026", confidence="direct",
         source_title="Hamas Accepts the Gaza Roadmap: Political Breakthrough, Implementation Uncertainty",
         source_publisher="The Washington Institute for Near East Policy", source_date="2026-08-07",
         source_url="https://www.washingtoninstitute.org/policy-analysis/hamas-accepts-gaza-roadmap-political-breakthrough-implementation-uncertainty",
         evidence="Khalil al-Hayya's rise to power within Hamas's Doha-based senior leadership council enabled internal acceptance of the disarmament roadmap."),
    dict(entity_a="Israel", entity_a_type="country", relationship_type="allied_with",
         entity_b="UAE, Bahrain, Morocco, Sudan (Abraham Accords)", entity_b_type="country", as_of="since 2020", confidence="direct",
         source_title="The Abraham Accords",
         source_publisher="U.S. Department of State", source_date="2020-09-15",
         source_url="https://www.state.gov/the-abraham-accords/",
         evidence="Signatories: Israel, United Arab Emirates, Bahrain, Morocco, Sudan; core commitments on diplomatic relations and cooperation."),
    dict(entity_a="United States", entity_a_type="country", relationship_type="funds",
         entity_b="Israel", entity_b_type="country", as_of="2019-2028 MOU", confidence="direct",
         source_title="U.S. Foreign Aid to Israel: Overview and Developments since October 7, 2023 (CRS RL33222)",
         source_publisher="Congressional Research Service", source_date="2025-05-28",
         source_url="https://www.everycrsreport.com/reports/RL33222.html",
         evidence="The September 2016 MOU commits the US to $38 billion in military aid ($33B FMF grants + $5B missile defense) over FY2019-FY2028."),
    dict(entity_a="Turkey", entity_a_type="country", relationship_type="allied_with",
         entity_b="Saudi Arabia and Pakistan (Mecca Agreement)", entity_b_type="country", as_of="since Aug 7, 2026", confidence="direct",
         source_title="The Mecca Agreement Unpacked",
         source_publisher="Carnegie Endowment for International Peace", source_date="2026-08-13",
         source_url="https://carnegieendowment.org/middle-east/diwan/2026/08/the-mecca-agreement-unpacked",
         evidence="Turkey, Saudi Arabia, and Pakistan signed a mutual-defense pact on August 7, 2026: \"any armed attack against any one of the three States shall be regarded as an attack against them all.\""),
    dict(entity_a="Saudi Arabia", entity_a_type="country", relationship_type="normalized_relations_with",
         entity_b="Iran", entity_b_type="country", as_of="since 2023, mediation continuing 2025", confidence="direct",
         source_title="Saudi Arabia: Background and U.S. Relations (CRS RL33533)",
         source_publisher="Congressional Research Service", source_date="2023-10-02",
         source_url="https://www.everycrsreport.com/reports/RL33533.html",
         evidence="China \"facilitated the apparent culmination\" of Saudi-Iran talks, restoring diplomatic ties in April 2023; Iran reopened its Riyadh embassy in August 2023."),
    dict(entity_a="UAE", entity_a_type="country", relationship_type="exited",
         entity_b="OPEC", entity_b_type="organization", as_of="Apr 2026", confidence="direct",
         source_title="America Must Avoid Picking Sides in the Saudi-Emirati Feud",
         source_publisher="Gulf International Forum", source_date="2026-05-14",
         source_url="https://gulfif.org/america-must-avoid-picking-sides-in-the-saudi-emirati-feud/",
         evidence="The UAE left OPEC in April 2026, described as \"a direct blow to the Saudi-led energy bloc.\""),
    dict(entity_a="Kata'ib Hezbollah", entity_a_type="group", relationship_type="controls_territory_of",
         entity_b="Jurf al-Sakhr, Iraq", entity_b_type="facility", as_of="as of Aug 2026", confidence="direct",
         source_title="Iran Update Special Report, August 20, 2026",
         source_publisher="Critical Threats Project (AEI) / Institute for the Study of War", source_date="2026-08-20",
         source_url="https://www.criticalthreats.org/analysis/iran-update-special-report-august-20-2026",
         evidence="Kataib Hezbollah has controlled Jurf al-Sakhr, Iraq, for over a decade, refusing to cede it to Iraqi sovereignty."),
    dict(entity_a="Egypt", entity_a_type="country", relationship_type="mediated",
         entity_b="Israel-Hamas Gaza ceasefire", entity_b_type="event", as_of="Oct 2025", confidence="direct",
         source_title="Egypt: Background and U.S. Relations (CRS RL33003)",
         source_publisher="Congressional Research Service", source_date="2026-02-25",
         source_url="https://www.everycrsreport.com/reports/RL33003.html",
         evidence="Egypt hosted the October 2025 Sharm el-Sheikh Peace Summit, where President Trump, President Sisi, and other leaders endorsed a Gaza ceasefire agreement."),
]


def main_ingest():
    import main as _m
    with TestClient(_m.app) as client:
        headers = _get_admin_auth_headers()
        r = client.post("/api/forge/ontology/claims/bulk", json={"claims": CLAIMS}, headers=headers)
        r.raise_for_status()
        result = r.json()
        print(f"Submitted: {result['submitted']}  Created (pending review): {result['created']}  "
              f"Skipped (uncited): {result['skipped_uncited']}")

        r2 = client.get("/api/forge/ontology/claims", params={"status": "pending"}, headers=headers)
        pending = r2.json()
        print(f"Total pending claims now in queue: {len(pending)}")
        return result, pending


if __name__ == "__main__":
    main_ingest()
