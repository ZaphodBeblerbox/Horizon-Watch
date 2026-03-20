"""
TANZANIA STRATEGIC CONTEXT DOCUMENT
Akili Intelligence Platform — Backend Knowledge Base
Version 2.0 | Knowledge cutoff: August 2025

NEUTRALITY POLICY:
This document presents factual, analytical, and historically grounded information derived
entirely from open sources. It does not advocate for any political position, ethnic group,
religious faction, foreign government, or commercial interest. Contested historical claims
are labelled as such. The purpose is to enable accurate, contextualised intelligence
analysis — not to influence policy.

USAGE:
This file is imported by backend/main.py and injected (in relevant sections) into Claude
API calls to provide Tanzania-specific strategic context for all analysis functions.
"""

TANZANIA_CONTEXT = {

    "foundational_identity": {
        "formal_name": "United Republic of Tanzania",
        "formation_and_union": (
            "Tanzania was created on 26 April 1964 through the union of two distinct "
            "states: Tanganyika (independent from Britain on 9 December 1961 under Julius "
            "Nyerere) and the People's Republic of Zanzibar (which had just undergone a "
            "violent revolution on 12 January 1964 overthrowing the Arab Omani sultanate "
            "under the leadership of Abeid Amani Karume and John Okello). The union was "
            "negotiated rapidly, partly to prevent Zanzibar from becoming a Cold War "
            "flashpoint. The union remains constitutionally asymmetric and fundamentally "
            "incomplete: Zanzibar retains its own Revolutionary Government (SMZ), its own "
            "president, House of Representatives, courts, police, and immigration system. "
            "The union government handles defence, foreign affairs, and federal matters. "
            "This structural ambiguity is a permanent source of legal, political, and "
            "financial friction."
        ),
        "capitals": (
            "Dodoma is the official constitutional capital housing the National Assembly "
            "and presidency. Dar es Salaam remains the functional, commercial, and "
            "diplomatic capital — most embassies, major banks, and private sector "
            "headquarters remain there. The relocation to Dodoma is ongoing but incomplete."
        ),
        "population_and_demographics": (
            "Population approximately 65-67 million (2024), growing at 2.9% annually — "
            "one of the world's highest rates. Median age approximately 17-18 years. "
            "Dar es Salaam approaching 8 million and growing at 5-6% annually. "
            "Approximately 65-70% of population remains rural. The extreme youth of "
            "the population creates: rapidly growing labour force, massive urbanisation "
            "pressure, demand for jobs and services the state struggles to meet, and a "
            "large politically mobilisable youth cohort."
        ),
        "geographic_strategic_position": (
            "Tanzania borders eight countries: Kenya (north), Uganda (northwest), Rwanda "
            "(northwest), Burundi (west), DRC (west, across Lake Tanganyika), Zambia "
            "(southwest), Malawi (southwest, boundary partially disputed), and Mozambique "
            "(south). It has a 1,424km Indian Ocean coastline. The Port of Dar es Salaam "
            "is the primary maritime gateway for six landlocked neighbours: Zambia, Malawi, "
            "Rwanda, Burundi, eastern DRC, and parts of Uganda — giving Tanzania structural "
            "economic leverage independent of any political relationship. Tanzania also "
            "contains Africa's highest peak (Kilimanjaro), world's second deepest lake "
            "(Tanganyika), Africa's largest lake by area (Victoria), and the Serengeti ecosystem."
        ),
    },

    "political_system": {
        "structure": (
            "Presidential republic. President is head of state, government, and "
            "commander-in-chief. National Assembly (Bunge) has 393 seats. De facto "
            "single-party dominant system — CCM (Chama Cha Mapinduzi) has governed "
            "continuously since 1961 under various names. Multi-party system reintroduced "
            "1992 but opposition has never come close to winning on the mainland."
        ),
        "ccm_and_factions": (
            "CCM is not merely a party — it is a parallel state structure penetrating "
            "every administrative level. CCM membership is effectively required for civil "
            "service advancement. Identifiable internal factions: "
            "(1) Samia Reformist — pragmatic, pro-Western donor engagement, cautiously "
            "opening political space. "
            "(2) Magufuli Hardliner — nationalist, statist, resistant to governance reform, "
            "many in security services and party structure. "
            "(3) Old Guard Mkapa/Kikwete network — entrenched rent-seeking particularly "
            "in mining and land. "
            "(4) Zanzibar Bloc — elevated by Samia's presidency, pushing greater resource "
            "sharing and autonomy. "
            "(5) Regional Ethnic Blocs — informal groupings expecting proportional "
            "representation in cabinet."
        ),
        "samia_suluhu_hassan": (
            "Sworn in March 2021 after Magufuli's death (widely understood as COVID-19). "
            "Africa's first female head of state of a major nation. From Zanzibar — both "
            "symbolically significant and politically complex. Policy departures from "
            "Magufuli: IMF re-engagement, World Bank restoration, COVID vaccination, "
            "partial media and civil society opening, more pragmatic foreign policy. "
            "Faces pressure from CCM hardliners, opposition demanding faster reform, "
            "and Zanzibar unionists. October 2025 elections are her first as candidate "
            "for a full term."
        ),
        "opposition": (
            "CHADEMA (main opposition) — strongest in urban areas and among educated youth. "
            "Leader Tundu Lissu survived 2017 assassination attempt (shot 16 times, "
            "attributed to state actors though unproven). Faces systematic harassment, "
            "rally bans, candidate arrests. Only credible opposition force but structurally "
            "unable to overcome CCM's institutional advantages. "
            "CUF — historically strongest in Zanzibar, significantly weakened since 2020. "
            "Informal opposition operates through social media, civil society, and "
            "independent media that survived Magufuli's crackdowns."
        ),
        "zanzibar": (
            "Zanzibar's politics are categorically different. 97%+ Muslim. Historical "
            "Arab-African tension culminating in the violent 1964 revolution remains a "
            "defining reference. 30-40% of Zanzibaris favour full independence. "
            "Semi-autonomous in practice: own immigration, courts, police, president. "
            "Tourism-dependent economy creates different interests from mainland. "
            "Pemba island historically more opposition-leaning and Arab-influenced. "
            "Gulf state investment in real estate and religious institutions significant. "
            "The union's constitutional ambiguity is a permanent negotiation."
        ),
    },

    "ethnic_social_composition": {
        "overview": (
            "Over 120 ethnic groups. No single majority. Tanzania has largely avoided "
            "ethnic political mobilisation at national level — Nyerere's deliberate policy "
            "of promoting Swahili and national identity over ethnic identity succeeded "
            "more than almost anywhere else in Africa. Ethnic identity exists and matters "
            "for patronage, marriage, and regional politics but has not produced "
            "national-level ethnic violence. This stability is real but not permanent — "
            "economic stress and deliberate manipulation could change it."
        ),
        "key_groups": (
            "Sukuma (~16%) — largest group, Lake Victoria region, agricultural/pastoralist, "
            "politically significant by numbers. "
            "Chagga (~5%) — Kilimanjaro slopes, historically most educated and commercially "
            "active due to missionary contact and coffee wealth, disproportionately in "
            "civil service and professions, predominantly Catholic/Lutheran. "
            "Haya — Kagera region, coffee cultivators, strong Uganda cultural ties. "
            "Nyamwezi — Tabora region, historically dominant interior caravan traders. "
            "Makonde — southeastern Tanzania AND northern Mozambique's Cabo Delgado, "
            "cross-border ethnicity with direct security implications for insurgency spillover. "
            "Maasai — northern Tanzania and Kenya, seminomadic pastoralists, chronic land "
            "conflicts with conservation, resistant to national identity assimilation. "
            "South Asian diaspora (~50-100k) — Gujarati and Ismaili families dominant in "
            "retail, import-export, manufacturing; politically low-profile but economically "
            "essential; many hold Western passports. "
            "Chinese community (~10-50k, uncertain) — growing with BRI investment, "
            "subject to local resentment, politically protected by China relationship."
        ),
        "religion": (
            "Approximately 35-40% Muslim, 35-40% Christian, remainder traditional/blended. "
            "Government has not published religious census since 1967 — doing so is "
            "considered politically inflammatory. By longstanding convention the presidency "
            "alternates between Muslim and Christian — not written in law but treated as "
            "constitutional. Violating it would trigger serious political crisis. "
            "Zanzibar 97%+ Muslim. Coastal mainland predominantly Muslim. Interior "
            "highlands predominantly Christian. "
            "Muslim community: historically Sufi-influenced, increasingly contested by "
            "Gulf-funded Salafi/Wahhabi reformism — visible in mosque governance disputes, "
            "dress codes, and community tensions. Security services monitor Gulf "
            "religious funding as radicalisation vector. "
            "Christian community: Catholic dominant in north and highlands, Lutheran "
            "significant, Pentecostal/evangelical growing rapidly in cities."
        ),
    },

    "historical_context": {
        "maji_maji": (
            "Maji Maji Rebellion (1905-1907) against German colonial rule united ~20 "
            "ethnic groups. German scorched-earth response killed 200,000-300,000 "
            "Tanzanians mostly through famine. Foundational anti-colonial memory, "
            "celebrated annually, referenced in political discourse."
        ),
        "zanzibar_revolution_1964": (
            "12 January 1964: violent overthrow of Arab Omani sultanate. Explicitly racial — "
            "Arab and Arab-descended Zanzibaris targeted. Deaths estimated hundreds to "
            "thousands; thousands more expelled. The union with Tanganyika followed within "
            "months, partly to contain Cold War interest (Cuba, USSR, China) in the "
            "revolutionary government. Officially celebrated 12 January. Defines modern "
            "Zanzibari political identity — both as liberation and as persecution depending "
            "on community."
        ),
        "nyerere_legacy": (
            "Julius Nyerere (Mwalimu — The Teacher) remains Tanzania's defining political "
            "figure. Key legacies: "
            "Ujamaa villagisation (1973-77) — forced relocation of ~5 million people. "
            "Economically failed (agricultural production collapsed), human rights "
            "violations documented, but produced: rural literacy rise to ~85%, expanded "
            "healthcare, and — most durably — national identity over ethnic identity. "
            "Pan-African liberation support — Tanzania hosted ANC, ZANU, ZAPU, FRELIMO, "
            "SWAPO. This gives Tanzania deep relationships with governing parties of "
            "South Africa, Zimbabwe, Mozambique, Namibia, Angola. "
            "Uganda War (1979) — Tanzania invaded Uganda, overthrew Idi Amin after his "
            "occupation of Kagera region. Demonstrated military capability and willingness "
            "to act on principle. Cost ~$500m, contributed to economic crisis of 1980s. "
            "Voluntary retirement (1985) — rare in African politics, set constitutional "
            "norm for peaceful transfer of power. Catholic beatification process active "
            "(declared Venerable 2020)."
        ),
        "magufuli_era": (
            "John Magufuli (2015-2021): systematic authoritarian turn — opposition "
            "crackdown, media bans, journalist arrests, NGO expulsion, IMF withdrawal, "
            "COVID denialism, homophobic purges. Simultaneously: anti-corruption drives "
            "(genuine in some sectors), SGR railway and Julius Nyerere dam investment, "
            "economic nationalism (mining contract renegotiation, Acacia Mining "
            "$300m settlement). Legacy genuinely contested. Death March 2021 "
            "from undisclosed causes widely understood as COVID-19."
        ),
    },

    "economy": {
        "overview": (
            "GDP ~$75-85 billion (2024). Growth 6-7% annually — among Africa's most "
            "consistent. GDP per capita ~$1,100-1,200 nominal. Services ~45% of GDP, "
            "agriculture 26%, industry 27%. High inequality — growth not broadly shared. "
            "Poverty ~26% below national line. Shilling has depreciated steadily "
            "(1,600 to ~2,500 TZS/USD since 2010)."
        ),
        "key_sectors": (
            "Gold: Largest export commodity, ~$2.5-3bn annually. Lake Victoria Goldfields "
            "(Geita, Shinyanga, Mwanza). Major mines: AngloGold Ashanti (Geita), Barrick "
            "(North Mara, Bulyanhulu). ASM (artisanal) very large — 1-1.5m people, much "
            "exported informally via Dubai without declaration. "
            "Natural Gas: 57 TCF offshore reserves (Ruvuma Basin). Shell, Equinor, TPDC. "
            "LNG terminal planned near Lindi — delayed 10+ years. FID could unlock "
            "$5-10bn annually at peak — transformative. Negotiations with Shell/Equinor "
            "ongoing under Samia. "
            "Tourism: ~$2.6bn pre-COVID from ~1.5m arrivals. Serengeti, Ngorongoro, "
            "Kilimanjaro, Zanzibar, Selous/Nyerere. Extremely sensitive to security "
            "perceptions and conservation controversies. "
            "Agriculture: 65% of workforce, 26% of GDP — massive productivity gap. "
            "Key exports: coffee, tea, cashews (Africa's largest producer), tobacco, "
            "sisal, cloves (Zanzibar), cut flowers. "
            "Port of Dar es Salaam: Regional gateway for 6 landlocked neighbours. "
            "SGR railway under construction (China EXIM financed, ~$14bn full network) "
            "will dramatically increase hinterland reach and reduce Mombasa competition. "
            "Tanzanite: Global monopoly on unique gemstone. Merelani, Arusha region. "
            "Kabanga Nickel: World-class undeveloped nickel sulphide deposit. Lifezone "
            "Metals (US-listed). Critical for EV battery supply chains. "
            "EACOP: Uganda-Tanzania crude oil pipeline to Tanga port — under construction."
        ),
        "debt_and_donors": (
            "Public debt ~40-45% of GDP. Chinese bilateral debt largest component "
            "(SGR financing). Aid ~20-30% of development budget — donors (US, EU, UK, "
            "Nordics) have leverage on governance, LGBT rights, press freedom. "
            "Magufuli withdrew from IMF 2017-2021. Samia restored relationship. "
            "LNG revenue if realised would end donor dependence entirely."
        ),
    },

    "foreign_policy": {
        "doctrine": (
            "Five pillars: Non-alignment (balance US/China/Gulf, avoid bloc commitment); "
            "African solidarity (AU frameworks, sovereignty, non-interference); "
            "Anti-colonialism (will not host foreign military bases — near-inviolable); "
            "Regional integration (EAC/SADC member, but most cautious on pace); "
            "Economic nationalism (domestic benefit from resources, mandatory government "
            "equity, local content, willing to renegotiate contracts)."
        ),
        "china": (
            "Largest bilateral infrastructure investor. Relationship rooted in Cold War "
            "solidarity (TAZARA railway 1975). Current: SGR (CRCC/CCCC contractors, EXIM "
            "financing), port upgrades, hospitals, retail presence. DP World manages Dar "
            "port terminals. Bagamoyo SEZ port rejected by Magufuli as sovereignty risk. "
            "China provides UN diplomatic protection from Western human rights resolutions. "
            "Risks: debt sustainability, labour resentment, trade imbalance, technology "
            "dependency (Huawei telecoms infrastructure)."
        ),
        "united_states": (
            "Important but secondary to China. PEPFAR (~$500m annually, 1m+ on ARVs — "
            "critical leverage), AGOA trade preferences, MCC infrastructure compacts, "
            "USAID, AFRICOM security cooperation. US Embassy Dar is among Africa's largest "
            "(post-1998 bombing security upgrade). Friction: LGBT rights criminalisation, "
            "election credibility, China engagement concerns, EACOP climate opposition."
        ),
        "gulf_states": (
            "Saudi Arabia: Primary religious influence, mosque/madrasa funding, Salafi "
            "reformism spread, student scholarships. "
            "UAE: Most commercially active. Dubai major informal gold export destination. "
            "DP World port concession. Zanzibar real estate investment. Minimal gold "
            "origin scrutiny makes Dubai Tanzania's preferred informal financial hub. "
            "Qatar: Al Jazeera coverage, Qatar Charity social investment, competition "
            "with Saudi for Muslim community influence. "
            "Zanzibar has warmer direct Gulf relations than mainland government — "
            "Muslim identity and semi-autonomy make it a Gulf soft power target."
        ),
        "india": (
            "Deep diaspora roots (150yr Gujarati/Ismaili presence). Growing trade — "
            "top 5 partner. Indian pharma supplies majority of generic ARVs. Indian "
            "Ocean strategy aligns with Tanzania partnership. Less aggressive than China "
            "in demanding exclusivity."
        ),
        "neighbours": (
            "Kenya: Most economically important neighbour. Friction: trade barriers, "
            "Mombasa vs Dar port competition, Maasai border grazing conflicts, EAC "
            "integration pace (Tanzania most cautious). "
            "Uganda: EACOP pipeline creates permanent infrastructure interdependence. "
            "1979 war legacy. Museveni longevity a point of ideological tension. "
            "Rwanda: Kagame's assertiveness and DRC proxy role (M23 support) create "
            "friction. Tanzania is DRC peace mediator creating implicit counter-pressure. "
            "Burundi: 150-200k refugees in Kigoma. Multiple crisis cycles since 1972. "
            "Complex cross-border ethnic and social networks. "
            "DRC: Most significant ongoing security challenge. Lake Tanganyika border. "
            "Arms, minerals, refugees, armed group infiltration vectors. TPDF deployed "
            "to EAC Regional Force. M23/Rwanda escalation 2024-25 most acute in years. "
            "Mozambique: Most direct external security threat. Cabo Delgado insurgency "
            "shares Makonde ethnicity, geographic proximity, economic marginalisation "
            "with Tanzania's Mtwara/Lindi regions. Cross-border arms, recruitment, "
            "individual movement documented. Tanzania has not deployed forces into "
            "Mozambique but has reinforced Ruvuma border. "
            "Zambia/Malawi: Primarily trade corridor relationships. Lake Malawi boundary "
            "disputed (Tanzania claims eastern shore; Malawi claims thalweg) — "
            "strategic because of hydrocarbon exploration rights."
        ),
    },

    "security": {
        "tpdf": (
            "Tanzania People's Defence Force: Army (~23,000), Navy (~1,000), Air Defence "
            "Command (~3,000). Professional, apolitical by African standards. No coups "
            "in history. Consistent constitutional loyalty. Top-20 global UN peacekeeping "
            "contributor (ATMIS Somalia, MONUSCO DRC, MINUSMA Mali, UNMISS South Sudan) — "
            "generates ~$30-50m annually and combat training. SUMA JKT (military commercial "
            "arm) operates businesses in agriculture, construction, water, manufacturing."
        ),
        "threats": (
            "Mozambique insurgency spillover: PRIMARY threat. Makonde cross-border ethnicity, "
            "economic marginalisation in Mtwara/Lindi matching Cabo Delgado conditions, "
            "documented individual movement, arms smuggling risk. "
            "Al-Shabaab: Active recruitment networks on coast and Zanzibar. Tanzania's "
            "ATMIS contribution makes it a stated target. 1998 US Embassy bombing precedent. "
            "DRC armed groups: ADF (ISIS-affiliated since 2019), FDLR, Mayi-Mayi near "
            "Lake Tanganyika. Cross-lake infiltration possible and periodically documented. "
            "Organised crime: Dar es Salaam port is documented heroin transit hub "
            "(Afghan Southern Route). Wildlife trafficking (ivory, rhino) — Chinese and "
            "Southeast Asian networks, corrupt officials involved. Timber, human trafficking. "
            "Domestic risk: Urban youth unemployment (~30-40% Dar es Salaam), political "
            "suppression, Zanzibar separatism. Zanzibar election violence precedent "
            "(2000, 2005 most severe)."
        ),
    },

    "power_structures": {
        "ccm_network": (
            "CCM operates as patronage network at every administrative level. Contracts, "
            "land allocation, licences, appointments all flow through party channels. "
            "Balozi (cell leaders) system provides urban surveillance capability. "
            "TISS (Tanzania Intelligence and Security Service) reports to presidency — "
            "significantly empowered under Magufuli, lower profile under Samia but "
            "capabilities unchanged."
        ),
        "business_elite": (
            "South Asian commercial families (Karimjee, various Gujarati trading families) "
            "— maintain relationships with multiple governments as survival strategy. "
            "African Tanzanian business class — emerged through CCM-linked privatisation. "
            "Mining sector figures — junior mining, ASM trading, multinational local partners. "
            "Former officials leveraging office connections. Beneficial ownership opacity is significant."
        ),
        "religious_power": (
            "Bakwata (Muslim Council) — government-aligned, mainstream Sunni, patronage "
            "channel for Muslim community. "
            "Catholic Bishops Conference (TEC) — more independent, willing to criticise "
            "corruption and governance. "
            "Large mosque and megachurch congregations represent political mobilisation "
            "potential that CCM takes seriously."
        ),
    },

    "trade_networks": {
        "exports": (
            "India: gold, cashews, gemstones (largest/second-largest destination). "
            "UAE/Dubai: gold (significant informal flow, minimal origin scrutiny), commodities. "
            "Switzerland: gold via refining chains. "
            "EU: coffee, tea, tobacco, horticulture, cashews. "
            "China: gold (growing), copper, timber, raw minerals."
        ),
        "imports": (
            "China: machinery, electronics, textiles, consumer goods, vehicles, "
            "construction materials — dominates Kariakoo market. "
            "India: pharmaceuticals (critical for ARV supply), textiles, vehicles. "
            "UAE: refined petroleum, re-exports. "
            "South Africa: machinery, vehicles, chemicals. "
            "Japan: vehicles (Toyota dominates — Land Cruisers standard for NGOs, "
            "government, safari operators)."
        ),
        "corridors": (
            "Central Corridor: Dar → Dodoma → Tabora → Kigoma → Lake Tanganyika → "
            "Rwanda/Burundi/DRC. SGR will transform this. "
            "TAZARA: Dar → Mbeya → Tunduma → Zambia → Southern Africa. 1,860km, "
            "Chinese-built 1975, requires rehabilitation. "
            "Tanga Corridor: Tanga port → Arusha → Kenya. EACOP terminus at Tanga. "
            "Indian Ocean: Primary route for all maritime trade. Dhow routes still "
            "active for informal coastal and Gulf trade."
        ),
        "informal_flows": (
            "ASM gold — potentially matching formal gold exports, mostly via Dubai "
            "undeclared. Mineral smuggling via Burundi and Kenya. Cross-border food, "
            "consumer goods, fuel informal trade with all 8 neighbours large. "
            "Kariakoo market Dar es Salaam — one of East Africa's largest informal centres."
        ),
    },

    "strategic_assessment": {
        "core_interests": [
            "Territorial integrity including Zanzibar union preservation",
            "CCM political continuity through managed transition",
            "Economic growth with sufficient poverty reduction to maintain cohesion",
            "Regional trade dominance via Dar port and corridor infrastructure",
            "Sovereign capture of resource wealth (gold, gas, minerals)",
            "Tourism revenue and ecosystem preservation",
            "Blue economy development (Indian Ocean fisheries, gas, shipping)",
            "Energy security (Julius Nyerere dam, gas-to-power)",
            "Regional security — preventing Mozambique/DRC spillover",
            "Non-alignment — avoiding entrapment in US-China competition",
            "LNG final investment decision — most transformative fiscal opportunity",
            "SGR completion for definitive logistics corridor dominance",
            "Kabanga nickel development for EV battery supply chain positioning",
        ],
        "strategic_assets": [
            "Port of Dar es Salaam — gateway for 6 landlocked neighbours",
            "Indian Ocean coastline 1,424km with deep water at Dar, Tanga, Mtwara",
            "SGR railway under construction — will create central corridor advantage",
            "TAZARA railway — existing Zambia/Southern Africa corridor",
            "Julius Nyerere Hydropower 2,115 MW when complete",
            "Offshore natural gas 57 TCF — potentially transformative LNG exports",
            "Gold production — Lake Victoria Goldfields",
            "Tanzanite — global monopoly",
            "Serengeti, Selous/Nyerere, Ngorongoro, Kilimanjaro — world-class tourism assets",
            "Zanzibar — Indian Ocean hub, heritage tourism, semi-autonomous flexibility",
            "EACOP pipeline terminus at Tanga",
            "Kabanga Nickel — world-class undeveloped EV-critical deposit",
            "Swahili linguistic unity — national cohesion rare in Africa",
            "Non-alignment posture — flexibility in great power competition",
            "Liberation movement legacy — diplomatic goodwill with ANC, FRELIMO, SWAPO, ZANU-PF",
        ],
        "vulnerabilities": [
            "Chinese debt sustainability — SGR financing structural dependency",
            "Electricity deficit — constrains manufacturing and FDI",
            "Port inefficiency — loses cargo share to Mombasa",
            "Youth unemployment ~30-40% in Dar es Salaam",
            "Climate vulnerability — rain-dependent agriculture, coastal flooding",
            "Aid dependency — 20-30% of development budget with governance conditions",
            "Mozambique insurgency proximity — demonstrated spillover risk",
            "Zanzibar separatist sentiment — structural union instability",
            "DRC instability on western border",
            "Corruption — TI CPI ~100-110 globally",
            "LNG development delayed 10+ years — massive opportunity cost",
            "Informal gold export leakage to Dubai — significant revenue foregone",
        ],
    },

    "current_context_2025": {
        "elections_october_2025": (
            "Samia seeking first full presidential term. CCM favoured. CHADEMA contesting "
            "under systemic disadvantage. International observers present — assessment "
            "affects donor relations. Zanzibar elections more contested, higher violence "
            "risk. Pre-election period: increased opposition restriction, state resource "
            "use by CCM, security activation."
        ),
        "lng_negotiations": (
            "Most consequential pending economic decision. Shell (operator) and Equinor "
            "in PSA renegotiation with Tanzanian government. More constructive under Samia. "
            "FID if reached → first exports in 7-10 years → $5-10bn annually at peak. "
            "Political pressure to close before October 2025 elections is significant. "
            "10+ year delay represents Tanzania's largest single opportunity cost."
        ),
        "eacop": (
            "Under construction. Originally 2025 completion, now 2026-2027. Uganda crude "
            "to Tanga port. Tanzania receives transit fees, creates permanent Uganda "
            "dependency. Western environmental campaign forced several banks out of "
            "financing. Tanzania/Uganda continued with alternative financing. Key case "
            "of Tanzania resisting Western pressure on sovereign development."
        ),
        "drc_crisis": (
            "Most acute phase since 2012-13. M23 (Rwanda-backed) captured Goma January "
            "2025, advancing in North Kivu. EAC Regional Force (included TPDF) largely "
            "withdrew 2024. Tanzania hosting Nairobi Process peace negotiations. "
            "Direct effects: Kigoma border security, refugee flows, Central Corridor "
            "trade volumes."
        ),
        "mozambique": (
            "Cabo Delgado insurgency continues. Rwandan forces and SADC Mission (SAMIM) "
            "engaged. Insurgency pushed back but not eliminated. Total Energies LNG at "
            "Afungi still suspended. Tanzania's southern border an active security concern. "
            "Cross-border Makonde networks, radicalisation risk in Mtwara/Lindi ongoing."
        ),
        "great_power_competition": (
            "US-China competition in Indian Ocean intensifying. China deepening: SGR, "
            "Bagamoyo port interest, digital infrastructure, Huawei telecoms. US engaging: "
            "MCC compact negotiations, DFC investment, AFRICOM cooperation. Tanzania's "
            "non-alignment extracts benefits from both but pressure to choose is growing. "
            "Risk of forced alignment increases as competition intensifies."
        ),
    },

    "analytical_framework": {
        "relevance_filters": (
            "When assessing any event for Tanzania, apply in order: "
            "(1) DIRECT IMPACT — territory, citizens, immediate neighbours affected? "
            "(2) TRADE — Dar port traffic, corridor flows, Indian Ocean shipping, commodity "
            "prices for exports (gold, coffee, cashews, gas), import costs (petroleum)? "
            "(3) SECURITY — empowers or weakens Mozambique insurgents, DRC armed groups, "
            "Al-Shabaab, organised crime, domestic opposition? "
            "(4) POLITICAL — affects donor relationships, Chinese leverage, Gulf engagement, "
            "EAC/AU positioning, non-alignment posture, election dynamics? "
            "(5) ECONOMIC OPPORTUNITY — new investment, market opening, commodity price "
            "advantage, infrastructure financing access? "
            "(6) PRECEDENT — changes major power behaviour, international norms Tanzania "
            "relies on, regional power balance, energy transition affecting resource development?"
        ),
        "strategic_calculus": (
            "Tanzania acts on a continuous strategic calculus. Recurring questions: "
            "Does this serve or threaten CCM political continuity? "
            "Does this extract maximum benefit from Tanzania's geographic position? "
            "Does this preserve non-alignment options? "
            "Does this uphold Nyerere-era international standing? "
            "Does this protect the Zanzibar union? "
            "Does this balance Chinese presence against other powers? "
            "Policies failing these tests tend to be resisted regardless of external pressure."
        ),
        "tone": (
            "All analysis factual, balanced, actionable. Present trade-offs honestly. "
            "Flag uncertainty. Do not advocate for any party, ethnic group, religious "
            "faction, or foreign power. Goal: equip decision-maker with accurate "
            "understanding of what is happening, why it matters for Tanzania specifically, "
            "and what realistic options exist."
        ),
    },
}


def get_context_for_prompt(sections: list = None) -> str:
    """Standard context — ~3,000 tokens. Use for conflict, infrastructure, route analysis."""
    if sections is None:
        sections = [
            "foundational_identity",
            "strategic_assessment",
            "security",
            "foreign_policy",
            "current_context_2025",
            "analytical_framework",
        ]

    def flatten(obj, depth=0) -> str:
        if isinstance(obj, str):
            return obj.strip()
        if isinstance(obj, list):
            return "\n".join(f"  • {str(i).strip()}" for i in obj)
        if isinstance(obj, dict):
            parts = []
            for k, v in obj.items():
                label = k.replace("_", " ").upper() if depth == 0 else k.replace("_", " ").title()
                parts.append(f"\n{'—' * (depth + 1)} {label}\n{flatten(v, depth + 1)}")
            return "\n".join(parts)
        return str(obj).strip()

    labels = {
        "foundational_identity": "FOUNDATIONAL IDENTITY",
        "political_system": "POLITICAL SYSTEM",
        "ethnic_social_composition": "ETHNIC AND SOCIAL COMPOSITION",
        "historical_context": "HISTORICAL CONTEXT",
        "economy": "ECONOMY",
        "foreign_policy": "FOREIGN POLICY AND ALLIANCES",
        "security": "SECURITY AND MILITARY",
        "power_structures": "POWER STRUCTURES",
        "trade_networks": "TRADE NETWORKS",
        "strategic_assessment": "STRATEGIC INTERESTS AND ASSETS",
        "current_context_2025": "CURRENT STRATEGIC CONTEXT 2025",
        "analytical_framework": "ANALYTICAL FRAMEWORK",
    }

    lines = ["=== TANZANIA STRATEGIC INTELLIGENCE CONTEXT ===", ""]
    for key in sections:
        if key in TANZANIA_CONTEXT:
            lines.append(f"\n{'=' * 50}")
            lines.append(f"  {labels.get(key, key.upper())}")
            lines.append(f"{'=' * 50}")
            lines.append(flatten(TANZANIA_CONTEXT[key]))
    return "\n".join(lines)


def get_minimal_context() -> str:
    """Minimal context — ~800 tokens. Use for relevance scoring only."""
    return get_context_for_prompt(sections=[
        "strategic_assessment",
        "current_context_2025",
        "analytical_framework",
    ])


def get_full_context() -> str:
    """Full context — ~7,000 tokens. Use only for deep strategic brief queries."""
    return get_context_for_prompt(sections=list(TANZANIA_CONTEXT.keys()))


def get_relevance_prompt() -> str:
    return (
        "\n\nUsing the Tanzania strategic context above, assess this event's relevance "
        "to Tanzania:\n"
        "1. Direct territorial/citizen impact (0-10)\n"
        "2. Trade and economic impact (0-10)\n"
        "3. Security implications (0-10)\n"
        "4. Political/diplomatic implications (0-10)\n"
        "5. Strategic opportunity or threat (0-10)\n\n"
        "Tanzania Relevance Score: X/10\n"
        "Rationale: [one sentence]\n"
    )
