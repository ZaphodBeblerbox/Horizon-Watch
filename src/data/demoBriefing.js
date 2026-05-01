/**
 * demoBriefing.js — Hardcoded Horizon Watch demo scenarios.
 * No Claude generation, no live data. Plays identically every time.
 *
 * Scenario 1: Strait of Hormuz Crisis
 * Scenario 2: Sahel Siege (Gao, Mali)
 * Scenario 3: Satellite Intelligence (Isfahan Air Base, Iran)
 */

export const DEMO_BRIEFING_HORMUZ = {
  id:    "demo-hormuz-crisis",
  title: "OPERATION HORIZON — STRAIT OF HORMUZ",

  scenes: [

    // ── 1. INTRO ─────────────────────────────────────────────────────────────
    {
      id:       "intro-global",
      scenario: "hormuz",
      title:    "HORIZON WATCH ACTIVATED",
      narration: "Welcome to Horizon Watch — a real-time geopolitical intelligence platform. Our systems continuously monitor global maritime traffic, track military deployments, analyse satellite imagery, and process over two hundred seventy news sources around the clock. In the next few minutes, we will demonstrate how Horizon Watch detects, analyses, and responds to an emerging maritime threat. Let us begin with the world's most critical chokepoint.",
      center:   [25, 50], zoom: 4, duration: 3000,
      scene_elements: [],
      post_delay: 1000,
    },

    // ── 2. HORMUZ OVERVIEW ───────────────────────────────────────────────────
    {
      id:       "hormuz-overview",
      scenario: "hormuz",
      title:    "STRAIT OF HORMUZ",
      narration: "The Strait of Hormuz. Twenty-one percent of the world's liquid petroleum transits this narrow waterway every single day — roughly nineteen point two million barrels. At its narrowest point, the strait measures just twenty-one nautical miles across, with traffic separation lanes only two miles wide in each direction. Every tanker carrying Saudi, Kuwaiti, Emirati, or Iranian crude must pass through here. Horizon Watch maintains twenty-four hour surveillance of this chokepoint using AIS vessel tracking, satellite imagery, and signals intelligence.",
      center:   [26.56, 56.25], zoom: 8, duration: 3000,
      scene_elements: [
        { type: "chokepoint_from_db", name: "Strait of Hormuz", color: "#ef4444" },
        { type: "data_callout", label: "DAILY OIL TRANSIT",    value: "21%",    sublabel: "of global petroleum supply", position: "bottom-right" },
        { type: "data_callout", label: "DAILY VESSEL TRAFFIC", value: "80–130", sublabel: "ships per day",              position: "top-right" },
      ],
      post_delay: 1500,
    },

    // ── 3. BANDAR ABBAS ──────────────────────────────────────────────────────
    {
      id:       "bandar-abbas",
      scenario: "hormuz",
      title:    "IRGCN HEADQUARTERS",
      narration: "Horizon Watch has identified increased naval activity at Bandar Abbas — home port of the Islamic Revolutionary Guard Corps Navy. Our vessel tracking systems have detected three Tondar-class fast attack craft departing the port in close formation. These vessels displace forty-seven tons, reach speeds of fifty knots, and are equipped with Chinese-made C-802 anti-ship cruise missiles with a range of one hundred twenty kilometres. Their departure was logged at zero three forty-seven Zulu.",
      center:   [27.18, 56.28], zoom: 14, duration: 2500,
      scene_elements: [
        { type: "facility_marker", name: "Bandar Abbas Naval Base", lat: 27.18, lng: 56.28, color: "#ef4444", description: "IRGCN headquarters — Tondar FAC home port", image_query: "Bandar Abbas" },
        { type: "spotlight",       lat: 27.18, lng: 56.28, radius: 6000, color: "#ef4444" },
        {
          type: "ship_animation",
          vessels: [
            { name: "IRGCN-201 (Tondar-1)", color: "#ef4444", icon: "fast_attack", speed_knots: 45, path: [[27.18,56.28],[27.10,56.35],[26.95,56.45],[26.80,56.55]] },
            { name: "IRGCN-202 (Tondar-2)", color: "#ef4444", icon: "fast_attack", speed_knots: 45, path: [[27.16,56.30],[27.08,56.37],[26.93,56.47],[26.78,56.57]] },
            { name: "IRGCN-203 (Tondar-3)", color: "#ef4444", icon: "fast_attack", speed_knots: 45, path: [[27.20,56.26],[27.12,56.33],[26.97,56.43],[26.82,56.53]] },
          ],
        },
        { type: "data_callout", label: "VESSELS DETECTED", value: "3", sublabel: "Tondar-class FAC departing", position: "bottom-right" },
      ],
      post_delay: 2000,
    },

    // ── 4. TANKER INTERCEPT ──────────────────────────────────────────────────
    {
      id:       "strait-transit",
      scenario: "hormuz",
      title:    "INTERCEPT COURSE DETECTED",
      narration: "Horizon Watch predictive tracking has identified an intercept vector. The three IRGCN fast attack craft are on a converging course with Motor Vessel Pacific Trader — a Panamanian-flagged very large crude carrier currently transiting the eastbound lane at twelve knots. The Pacific Trader is carrying two million barrels of Saudi crude bound for Yokohama, Japan. Its cargo is valued at approximately one hundred sixty-four million dollars. Our algorithms estimate intercept in twelve minutes at current speeds.",
      center:   [26.55, 56.50], zoom: 10, duration: 2500,
      scene_elements: [
        { type: "chokepoint_from_db", name: "Strait of Hormuz", color: "#ef4444" },
        {
          type: "ship_animation",
          vessels: [
            // FIX 6: eastbound through Hormuz — increasing longitude
            { name: "MV Pacific Trader", color: "#f59e0b", icon: "tanker", speed_knots: 15, path: [[26.70,56.20],[26.60,56.35],[26.50,56.50],[26.35,56.70]] },
          ],
        },
        { type: "intercept_line", from: [26.80,56.55], to: [26.50,56.50], color: "#ef4444", dashed: true,  label: "Intercept: ~12 min" },
        { type: "facility_marker", name: "MV Pacific Trader", lat: 26.45, lng: 56.60, color: "#f59e0b", description: "320,000 DWT VLCC — 2M bbl Saudi crude", image_query: "Oil tanker" },
        { type: "data_callout", label: "CARGO VALUE", value: "$164M", sublabel: "2 million barrels Saudi crude", position: "bottom-right" },
      ],
      post_delay: 1500,
    },

    // ── 5. DECISION POINT ────────────────────────────────────────────────────
    {
      id:       "decision-hormuz",
      scenario: "hormuz",
      title:    "THREAT ASSESSMENT: HIGH PRIORITY",
      narration: "Horizon Watch has classified this as a high-priority maritime threat. Three hostile fast attack craft are on an intercept course with a high-value commercial vessel in international waters. Our systems have escalated the alert to Combined Maritime Forces. Please select your recommended response.",
      center:   [26.55, 56.45], zoom: 9, duration: 1500,
      interactive: true,
      choices: [
        { id: "response-air",     label: "Scramble F-35s from Al Dhafra",    icon: "✈" },
        { id: "response-naval",   label: "Redirect USS Abraham Lincoln CSG", icon: "⚓" },
        { id: "response-monitor", label: "Continue monitoring",              icon: "◉" },
      ],
      scene_elements: [
        { type: "spotlight", lat: 26.55, lng: 56.45, radius: 25000, color: "#ef4444" },
        { type: "data_callout", label: "THREAT LEVEL", value: "HIGH", sublabel: "Intercept imminent — action required", position: "bottom-center", color: "#ef4444" },
      ],
      post_delay: 0,
    },

    // ── 6a. RESPONSE: AIR ────────────────────────────────────────────────────
    {
      id:       "response-air",
      scenario: "hormuz",
      title:    "AIR RESPONSE DEPLOYED",
      narration: "Horizon Watch has relayed the threat coordinates to the Combined Air Operations Center at Al Udeid. Two F-35 Lightning II fighters from the three hundred eightieth Air Expeditionary Wing at Al Dhafra have been scrambled. Time to station is estimated at fourteen minutes. The aircraft are carrying AGM-158C Long Range Anti-Ship Missiles as a deterrent payload. Our tracking systems will provide real-time situational awareness throughout the intercept.",
      center:   [24.25, 54.55], zoom: 8, duration: 2000,
      scene_elements: [
        // FIX 4: image_query changed to "F-35 Lightning II" (was "Al Dhafra Air Base" which returned F-16)
        { type: "facility_marker", name: "Al Dhafra Air Base", lat: 24.25, lng: 54.55, color: "#3b82f6", description: "USAF 380th Air Expeditionary Wing", image_query: "F-35 Lightning II" },
        { type: "spotlight", lat: 24.25, lng: 54.55, radius: 4000, color: "#3b82f6" },
        {
          type: "ship_animation",
          vessels: [
            { name: "Viper 01 (F-35A)", color: "#3b82f6", icon: "fighter", speed_kmh: 1900, path: [[24.25,54.55],[24.80,55.20],[25.50,55.80],[26.20,56.30],[26.55,56.45]] },
            { name: "Viper 02 (F-35A)", color: "#3b82f6", icon: "fighter", speed_kmh: 1900, path: [[24.25,54.55],[24.85,55.25],[25.55,55.85],[26.25,56.35],[26.50,56.50]] },
          ],
        },
        { type: "data_callout", label: "TIME TO STATION", value: "14 min", sublabel: "2× F-35A Lightning II", position: "bottom-right" },
      ],
      next_scene: "resolution-air",
      post_delay: 2000,
    },

    {
      id:       "resolution-air",
      scenario: "hormuz",
      title:    "THREAT NEUTRALISED",
      narration: "Horizon Watch confirms the IRGCN fast attack craft have reversed course and are returning to Bandar Abbas. The air presence was sufficient deterrent — no weapons were employed. Motor Vessel Pacific Trader continues its transit unmolested and will clear the strait in approximately forty minutes. Our systems will maintain elevated surveillance for the next seventy-two hours. This concludes the Strait of Hormuz demonstration.",
      center:   [26.55, 56.45], zoom: 9, duration: 2000,
      scene_elements: [
        {
          type: "ship_animation",
          vessels: [
            { name: "IRGCN-201 (Tondar-1 withdrawing)", color: "#ef4444", icon: "fast_attack", path: [[26.80,56.55],[26.95,56.45],[27.10,56.35],[27.18,56.28]] },
            { name: "IRGCN-202 (Tondar-2 withdrawing)", color: "#ef4444", icon: "fast_attack", path: [[26.78,56.57],[26.93,56.47],[27.08,56.37],[27.16,56.30]] },
            { name: "IRGCN-203 (Tondar-3 withdrawing)", color: "#ef4444", icon: "fast_attack", path: [[26.82,56.53],[26.97,56.43],[27.12,56.33],[27.20,56.26]] },
          ],
        },
        { type: "data_callout", label: "STATUS", value: "RESOLVED", sublabel: "Threat neutralised — watch continues", position: "bottom-center", color: "#22c55e" },
      ],
      next_scene: "scenario2-intro",
      post_delay: 2000,
    },

    // ── 6b. RESPONSE: NAVAL ──────────────────────────────────────────────────
    {
      id:       "response-naval",
      scenario: "hormuz",
      title:    "CARRIER STRIKE GROUP REDIRECTED",
      narration: "Horizon Watch has transmitted threat coordinates to Carrier Strike Group Three. USS Abraham Lincoln and her escorts are repositioning from the northern Arabian Sea. The carrier's combat air wing has a five hundred fifty nautical mile combat radius that already covers the entire strait. Two Arleigh Burke-class destroyers, USS Spruance and USS Preble, are moving to establish a defensive corridor for commercial traffic. Estimated arrival at the strait entrance is three hours twenty minutes.",
      center:   [23.5, 62.0], zoom: 6, duration: 2500,
      scene_elements: [
        {
          type: "ship_animation",
          vessels: [
            { name: "USS Abraham Lincoln (CVN-72)", color: "#3b82f6", icon: "carrier",   speed_knots: 28,
              path: [[22.85,63.35],[24.44,58.83],[25.25,57.11],[25.99,56.77],[26.51,56.80]] },
            { name: "USS Spruance (DDG-111)",       color: "#3b82f6", icon: "destroyer", speed_knots: 30,
              path: [[22.70,63.50],[24.20,58.90],[25.05,57.20],[25.80,56.90],[26.35,56.95]] },
            { name: "USS Preble (DDG-88)",          color: "#3b82f6", icon: "destroyer", speed_knots: 30,
              path: [[23.00,63.20],[24.65,58.75],[25.45,57.05],[26.15,56.65],[26.65,56.70]] },
          ],
        },
        { type: "radius_circle", lat: 25.8, lng: 57.5, radius_nm: 550, color: "#3b82f6", label: "CVW-9 Combat Radius" },
        { type: "facility_marker", name: "USS Abraham Lincoln", lat: 22.85, lng: 63.35, color: "#3b82f6", description: "Nimitz-class carrier — CSG-3 flagship", image_query: "USS Abraham Lincoln (CVN-72)" },
        { type: "data_callout", label: "CSG-3 ASSETS", value: "8", sublabel: "surface combatants en route", position: "bottom-right" },
      ],
      next_scene: "resolution-naval",
      post_delay: 2500,
    },

    {
      id:       "resolution-naval",
      scenario: "hormuz",
      title:    "DETERRENCE ESTABLISHED",
      narration: "Carrier Strike Group Three has established a maritime security presence in the lower Arabian Sea. The IRGCN fast attack craft reversed course upon detecting the carrier group's approach radar. Horizon Watch will maintain continuous tracking of both the carrier group and any IRGCN surface activity. The Pacific Trader completes its transit without incident. This concludes the Strait of Hormuz demonstration.",
      center:   [26.0, 57.0], zoom: 7, duration: 2000,
      scene_elements: [
        {
          type: "ship_animation",
          vessels: [
            { name: "IRGCN-201 (Tondar-1 withdrawing)", color: "#ef4444", icon: "fast_attack", path: [[26.80,56.55],[26.95,56.45],[27.10,56.35],[27.18,56.28]] },
            { name: "IRGCN-202 (Tondar-2 withdrawing)", color: "#ef4444", icon: "fast_attack", path: [[26.78,56.57],[26.93,56.47],[27.08,56.37],[27.16,56.30]] },
            { name: "IRGCN-203 (Tondar-3 withdrawing)", color: "#ef4444", icon: "fast_attack", path: [[26.82,56.53],[26.97,56.43],[27.12,56.33],[27.20,56.26]] },
          ],
        },
        { type: "data_callout", label: "STATUS", value: "DETERRED", sublabel: "CSG-3 maintaining presence", position: "bottom-center", color: "#22c55e" },
      ],
      next_scene: "scenario2-intro",
      post_delay: 2000,
    },

    // ── 6c. RESPONSE: MONITOR → ESCALATION ──────────────────────────────────
    {
      id:       "response-monitor",
      scenario: "hormuz",
      title:    "ESCALATION DETECTED",
      narration: "Horizon Watch passive surveillance registers critical escalation. IRGCN vessels have closed to within five nautical miles of Motor Vessel Pacific Trader. Warning — our electronic intelligence sensors detect the lead IRGCN vessel has activated its fire control radar. This is consistent with weapons targeting. Threat classification has been automatically elevated to CRITICAL. Immediate action is required.",
      center:   [26.50, 56.50], zoom: 11, duration: 2000,
      scene_elements: [
        { type: "spotlight", lat: 26.50, lng: 56.50, radius: 5000, color: "#ef4444" },
        { type: "intercept_line", from: [26.55,56.52], to: [26.48,56.48], color: "#ef4444", dashed: false, label: "FIRE CONTROL LOCK" },
        { type: "data_callout", label: "THREAT LEVEL", value: "CRITICAL", sublabel: "Fire control radar active", position: "bottom-center", color: "#ef4444" },
      ],
      next_scene: "response-air",
      post_delay: 2000,
    },

    // ══════════════════════════════════════════════════════════════════════════
    // SCENARIO 2: SAHEL SIEGE
    // ══════════════════════════════════════════════════════════════════════════

    {
      id:       "scenario2-intro",
      scenario: "sahel",
      title:    "THEATRE SHIFT — WEST AFRICA",
      narration: "Shifting our focus to West Africa. Horizon Watch has detected a significant escalation in militant activity across the Sahel region. Our news analysis systems have flagged coordinated attacks in northern Mali, while our infrastructure monitoring shows critical facilities at risk. Let us examine the situation in detail.",
      center:   [17, 0], zoom: 5, duration: 3000,
      scene_elements: [
        // FIX 1: country highlights — fillOpacity 0.25, weight 3, opacity 0.8
        { type: "country_highlight", name: "mali",         color: "#ef4444" },
        { type: "country_highlight", name: "burkina faso", color: "#f59e0b" },
        { type: "country_highlight", name: "niger",        color: "#f59e0b" },
        { type: "spotlight", lat: 17.0, lng: -4.0, radius: 700000, color: "#ef4444" },
        { type: "data_callout", label: "REGION",  value: "SAHEL",        sublabel: "West Africa — Mali, Niger, Burkina Faso", position: "bottom-right" },
        { type: "data_callout", label: "ALERT LEVEL", value: "ELEVATED", sublabel: "Militant activity detected",              position: "top-right" },
      ],
      post_delay: 1000,
    },

    {
      id:       "sahel-gao-overview",
      scenario: "sahel",
      title:    "GAO UNDER THREAT",
      narration: "Horizon Watch has identified three distinct militant columns converging on the strategic city of Gao in northern Mali. Our pattern analysis indicates this is a coordinated assault by Jama'at Nasr al-Islam wal Muslimin, known as JNIM. The group has demonstrated increasingly sophisticated command and control capabilities, including simultaneous multi-axis attacks on defended positions. Gao is home to a critical military airfield, the regional hospital, and serves as the gateway to northern Mali's mineral resources.",
      center:   [16.27, -0.05], zoom: 9, duration: 2500,
      scene_elements: [
        { type: "spotlight",       lat: 16.27, lng: -0.05, radius: 15000, color: "#ef4444" },
        { type: "facility_marker", name: "Gao",                    lat: 16.27, lng: -0.05, color: "#ef4444", description: "Strategic city — population 86,000",        image_query: "Gao Mali" },
        { type: "facility_marker", name: "Gao International Airport", lat: 16.25, lng: -0.01, color: "#3b82f6", description: "Military airfield — FAMa garrison",       image_query: "Gao Airport Mali" },
        { type: "facility_marker", name: "Regional Hospital",      lat: 16.28, lng: -0.04, color: "#22c55e", description: "Only major medical facility in region",    image_query: "Hospital Sahel Mali" },
        { type: "data_callout", label: "CIVILIAN POPULATION", value: "86,000", sublabel: "at risk in Gao", position: "bottom-right" },
      ],
      post_delay: 1500,
    },

    {
      id:       "sahel-troop-advance",
      scenario: "sahel",
      title:    "JNIM ADVANCE",
      narration: "Our tracking systems have identified three separate JNIM columns approaching Gao from the north, northeast, and west. The northern column, estimated at two hundred fighters with technicals and captured military vehicles, departed from positions near Kidal forty-eight hours ago. The northeastern column has crossed from Niger, suggesting cross-border coordination. The western column is advancing along the Niger River, using the vegetation as cover. Estimated time to contact: six hours.",
      center:   [16.27, -0.05], zoom: 8, duration: 2000,
      scene_elements: [
        {
          type: "troop_movement",
          units: [
            { name: "JNIM Northern Column",  strength: "~200", start: [18.45,  1.35], end: [16.50,  0.00], color: "#ef4444", icon: "infantry" },
            { name: "JNIM NE Column",        strength: "~120", start: [17.00,  2.50], end: [16.40,  0.10], color: "#ef4444", icon: "infantry" },
            { name: "JNIM Western Column",   strength: "~80",  start: [16.30, -1.80], end: [16.25, -0.20], color: "#ef4444", icon: "infantry" },
          ],
        },
        { type: "spotlight", lat: 16.27, lng: -0.05, radius: 12000, color: "#ef4444" },
        { type: "data_callout", label: "ESTIMATED HOSTILE FORCES", value: "400+",  sublabel: "fighters converging on Gao",     position: "bottom-right" },
        { type: "data_callout", label: "TIME TO CONTACT",           value: "6 hrs", sublabel: "estimated",                     position: "bottom-center", color: "#ef4444" },
      ],
      post_delay: 2000,
    },

    {
      id:       "sahel-street-level",
      scenario: "sahel",
      title:    "CITY DEFENSE ANALYSIS",
      narration: "Zooming into Gao at street level. Horizon Watch has mapped the city's critical infrastructure and identified defensive positions. The Malian Armed Forces garrison is located at the military camp on the southern edge of the city, with approximately four hundred fifty troops. The airfield on the eastern side provides the only rapid evacuation route. Our systems have identified three key chokepoints where defensive positions would be most effective: the northern bridge, the market junction, and the airport road.",
      center:   [16.27, -0.04], zoom: 16, duration: 2500,
      scene_elements: [
        { type: "facility_marker", name: "FAMa Military Camp",      lat: 16.255, lng: -0.045, color: "#3b82f6", description: "Garrison — 450 troops",                  image_query: "Mali military FAMA" },
        { type: "facility_marker", name: "Northern Bridge",         lat: 16.285, lng: -0.050, color: "#f59e0b", description: "Key defensive chokepoint" },
        { type: "facility_marker", name: "Market Junction",         lat: 16.272, lng: -0.042, color: "#f59e0b", description: "Central intersection — defensive position" },
        { type: "facility_marker", name: "Airport Road Checkpoint", lat: 16.260, lng: -0.015, color: "#f59e0b", description: "Controls access to evacuation route" },
        { type: "spotlight", lat: 16.255, lng: -0.045, radius: 1500, color: "#3b82f6" },
        { type: "spotlight", lat: 16.25,  lng: -0.01,  radius: 2000, color: "#22c55e" },
        { type: "data_callout", label: "FAMa GARRISON", value: "450", sublabel: "troops on station", position: "bottom-right" },
      ],
      post_delay: 1500,
    },

    {
      id:       "sahel-decision",
      scenario: "sahel",
      title:    "TACTICAL DECISION REQUIRED",
      narration: "Horizon Watch recommends establishing a defense perimeter around Gao's critical infrastructure. Our tactical analysis has generated three recommended courses of action based on terrain analysis, force disposition, and historical engagement patterns. Select your preferred defense strategy.",
      center:   [16.27, -0.04], zoom: 13, duration: 1500,
      interactive: true,
      choices: [
        { id: "defense-forward", label: "Mobile Defense — hold forward, mobile reserves",     icon: "🛡" },
        { id: "defense-inner",   label: "Area Defense — concentrate on key terrain",           icon: "🏛" },
        { id: "defense-air",     label: "Combined Arms — ground hold + close air support",     icon: "✈" },
      ],
      scene_elements: [
        { type: "spotlight", lat: 16.27, lng: -0.04, radius: 5000, color: "#f59e0b" },
        { type: "data_callout", label: "DECISION REQUIRED", value: "NOW", sublabel: "Select defense strategy", position: "bottom-center", color: "#f59e0b" },
      ],
      post_delay: 0,
    },

    {
      id:       "defense-forward",
      scenario: "sahel",
      title:    "FORWARD DEFENSE ESTABLISHED",
      narration: "Forward defense perimeter established. Horizon Watch is tracking the deployment of three infantry companies to blocking positions on the northern, northeastern, and western approaches. Anti-vehicle obstacles are being positioned on the main highways. Our drone surveillance assets are repositioning to provide overwatch of the perimeter. This configuration maximises early warning but stretches the garrison thin across a twelve kilometre front.",
      center:   [16.27, -0.04], zoom: 12, duration: 2500,
      scene_elements: [
        {
          type: "perimeter",
          points: [[16.32,-0.12],[16.33,-0.05],[16.33,0.03],[16.30,0.08],[16.24,0.08],[16.22,0.02],[16.22,-0.08],[16.25,-0.12],[16.32,-0.12]],
          color: "#3b82f6", dashed: true, label: "Forward Defense Line",
        },
        {
          type: "troop_deploy_interactive",
          garrison: [16.255, -0.045],
          companies: [
            { name: "Alpha Company",   color: "#3b82f6", icon: "infantry" },
            { name: "Bravo Company",   color: "#3b82f6", icon: "infantry" },
            { name: "Charlie Company", color: "#3b82f6", icon: "infantry" },
          ],
          zones: [
            { id: "north",     label: "North Block",   position: [16.32, -0.05] },
            { id: "northeast", label: "NE Junction",   position: [16.30,  0.06] },
            { id: "west",      label: "West Approach", position: [16.24, -0.10] },
          ],
        },
        {
          type: "flight_animation",
          aircraft: [{
            name: "Recon Drone", color: "#38bdf8", icon: "drone",
            path: [[16.27,-0.04],[16.32,0.02],[16.28,0.06],[16.24,0.02],[16.27,-0.04]],
          }],
        },
        { type: "data_callout", label: "PERIMETER LENGTH", value: "12 km", sublabel: "3 companies deployed", position: "bottom-right" },
        { type: "data_callout", label: "REINFORCEMENTS", value: "ETA 12 HRS", sublabel: "from Bamako — 2nd battalion", position: "top-right", color: "#3b82f6" },
      ],
      next_scene: "sahel-resolution",
      post_delay: 2000,
    },

    {
      id:       "defense-inner",
      scenario: "sahel",
      title:    "INNER PERIMETER SECURED",
      narration: "Inner defense perimeter established around the military camp, hospital, and airfield. This compact defensive posture concentrates firepower but cedes the outer city to the advancing militants. Horizon Watch estimates this configuration can hold against the incoming force for seventy-two hours, providing time for reinforcement or evacuation. Civilian movement corridors have been designated toward the airfield.",
      center:   [16.265, -0.03], zoom: 14, duration: 2500,
      scene_elements: [
        {
          type: "perimeter",
          points: [[16.28,-0.06],[16.28,-0.02],[16.28,0.01],[16.26,0.01],[16.24,-0.01],[16.24,-0.05],[16.26,-0.06],[16.28,-0.06]],
          color: "#22c55e", dashed: false, label: "Inner Perimeter",
        },
        { type: "facility_marker", name: "FAMa Military Camp",      lat: 16.255, lng: -0.045, color: "#3b82f6", description: "Garrison HQ" },
        { type: "facility_marker", name: "Regional Hospital",       lat: 16.28,  lng: -0.04,  color: "#22c55e", description: "Protected facility" },
        { type: "facility_marker", name: "Gao International Airport", lat: 16.25, lng: -0.01, color: "#22c55e", description: "Evacuation route" },
        {
          type: "troop_deploy_interactive",
          garrison: [16.255, -0.045],
          companies: [
            { name: "Alpha Company", color: "#22c55e", icon: "infantry" },
            { name: "Bravo Company", color: "#22c55e", icon: "infantry" },
          ],
          zones: [
            { id: "hospital", label: "Hospital",     position: [16.28, -0.04] },
            { id: "airport",  label: "Airport Road", position: [16.25, -0.01] },
            { id: "bridge",   label: "North Bridge", position: [16.285, -0.050] },
          ],
        },
        { type: "data_callout", label: "HOLDOUT ESTIMATE", value: "72 hrs", sublabel: "without reinforcement", position: "bottom-right" },
        { type: "data_callout", label: "REINFORCEMENTS", value: "ETA 12 HRS", sublabel: "from Bamako — 2nd battalion", position: "top-right", color: "#3b82f6" },
      ],
      next_scene: "sahel-resolution",
      post_delay: 2000,
    },

    {
      id:       "defense-air",
      scenario: "sahel",
      title:    "COMBINED ARMS — GROUND HOLD + CLOSE AIR SUPPORT",
      narration: "Horizon Watch has relayed the tactical situation to the Malian Armed Forces. This is a combined arms response: two Mi-24 Hind attack helicopters from Bamako-Sénou Air Base are inbound, while FAMa ground companies are simultaneously moving to blocking positions on the northern approaches. A reconnaissance drone is being repositioned to provide overwatch for the inbound gunships. Reinforcements are being requested from Bamako with an estimated arrival of twelve hours. Estimated time on station for the Mi-24s: fifty-five minutes.",
      center:   [14.50, -4.00], zoom: 7, duration: 2500,
      scene_elements: [
        { type: "facility_marker", name: "Bamako-Sénou Air Base", lat: 12.53, lng: -7.95, color: "#f97316", description: "FAMa air component — Mi-24 Hind base", image_query: "Mil Mi-24" },
        {
          type: "combined_ops",
          elements: [
            {
              type: "flight_animation",
              aircraft: [
                { name: "FAMa Mi-24 Hind 01", color: "#f97316", icon: "helicopter", speed_kmh: 250,
                  path: [[12.53,-7.95],[13.50,-5.00],[14.50,-3.00],[15.50,-1.50],[16.27,-0.04]] },
                { name: "FAMa Mi-24 Hind 02", color: "#f97316", icon: "helicopter", speed_kmh: 250,
                  path: [[12.53,-7.95],[13.60,-4.90],[14.60,-2.90],[15.60,-1.40],[16.30,-0.02]] },
              ],
            },
            {
              type: "troop_movement",
              units: [
                { name: "FAMa Alpha Co.", start: [16.255,-0.045], end: [16.32,-0.05], color: "#3b82f6", icon: "infantry" },
                { name: "FAMa Bravo Co.", start: [16.255,-0.045], end: [16.30, 0.06], color: "#3b82f6", icon: "infantry" },
              ],
            },
            {
              type: "flight_animation",
              aircraft: [{ name: "ISR Drone", color: "#38bdf8", icon: "drone",
                path: [[16.27,-0.04],[16.35,0.03],[16.30,0.08],[16.22,0.03],[16.27,-0.04]] }],
            },
            { type: "radius_circle", lat: 16.27, lng: -0.04, radius_nm: 4, color: "#f97316", label: "CAS Engagement Zone" },
          ],
        },
        { type: "data_callout", label: "TIME ON STATION", value: "55 min", sublabel: "2× FAMa Mi-24 Hind CAS", position: "bottom-right" },
        { type: "data_callout", label: "REINFORCEMENTS", value: "ETA 12 HRS", sublabel: "from Bamako — 2nd battalion", position: "top-right", color: "#3b82f6" },
      ],
      next_scene: "sahel-resolution",
      post_delay: 2500,
    },

    {
      id:       "sahel-resolution",
      scenario: "sahel",
      title:    "SITUATION STABILIZED",
      narration: "Horizon Watch confirms defensive positions are holding. The JNIM advance has been slowed by the prepared defenses, and coalition forces are responding to the developing situation. Our systems will continue monitoring force movements and providing tactical updates every fifteen minutes. Humanitarian corridors remain open to the airfield. This concludes the Sahel scenario. Horizon Watch continues its watch.",
      center:   [16.27, -0.04], zoom: 10, duration: 2000,
      scene_elements: [
        { type: "spotlight", lat: 16.27, lng: -0.04, radius: 20000, color: "#22c55e" },
        { type: "data_callout", label: "STATUS", value: "STABILIZED", sublabel: "Defensive positions holding", position: "bottom-center", color: "#22c55e" },
      ],
      next_scene: "scenario3-intro",
      post_delay: 2000,
    },

    // ══════════════════════════════════════════════════════════════════════════
    // SCENARIO 3: SATELLITE INTELLIGENCE — ISFAHAN AIR BASE, IRAN
    // ══════════════════════════════════════════════════════════════════════════

    {
      id:       "scenario3-intro",
      scenario: "isfahan",
      title:    "THEATRE SHIFT — SATELLITE INTELLIGENCE",
      narration: "Horizon Watch is now demonstrating its satellite intelligence and automated imagery analysis capabilities. Our overhead surveillance network has been tasked against a high-priority target in Iran. We are examining Isfahan Air Base — home of the Islamic Revolutionary Guard Corps Air Force's Eighth Tactical Fighter Base. Recent signals intelligence has indicated unusual activity at this facility. Initiating overwatch sequence.",
      center:   [32.5, 51.5], zoom: 5, duration: 3000,
      scene_elements: [
        { type: "country_highlight", name: "iran", color: "#ef4444" },
        { type: "spotlight", lat: 32.75, lng: 51.86, radius: 400000, color: "#ef4444" },
        { type: "data_callout", label: "TARGET",       value: "ISFAHAN",    sublabel: "Iran — IRGCAF 8th Tactical Fighter Base", position: "bottom-right" },
        { type: "data_callout", label: "INTELLIGENCE", value: "SIGINT+SAT", sublabel: "Multi-source fusion active",               position: "top-right" },
      ],
      post_delay: 1000,
    },

    {
      id:       "isfahan-approach",
      scenario: "isfahan",
      title:    "ISFAHAN AIR BASE",
      narration: "Isfahan Air Base sits twelve kilometres southwest of Isfahan city centre. The facility hosts Iran's F-14 Tomcat fleet — the only operational F-14s outside the United States — alongside Su-24 Fencer strike aircraft and a squadron of domestically-produced Kowsar fighters. The base includes hardened aircraft shelters, an active runway complex, and what our analysts assess as a missile assembly facility on the northern apron. Our satellite tasking has been approved — commencing overwatch pass now.",
      center:   [32.62, 51.70], zoom: 17, duration: 2500,
      scene_elements: [
        { type: "facility_marker", name: "Isfahan Air Base — South Apron", lat: 32.610, lng: 51.695, color: "#ef4444", description: "IRGCAF 8th TFB — open aircraft parking", image_query: "Isfahan Iran air base" },
        { type: "facility_marker", name: "HAS Complex Row A",              lat: 32.623, lng: 51.688, color: "#f59e0b", description: "Hardened aircraft shelters — northern side" },
        { type: "facility_marker", name: "HAS Complex Row B",              lat: 32.628, lng: 51.705, color: "#f59e0b", description: "Hardened aircraft shelters — secondary row" },
        { type: "facility_marker", name: "Northern Compound / TEL Park",   lat: 32.636, lng: 51.693, color: "#ef4444", description: "Assessed TEL parking — unconfirmed" },
        { type: "spotlight", lat: 32.617, lng: 51.695, radius: 2200, color: "#ef4444" },
        { type: "data_callout", label: "AIRCRAFT ASSESSED", value: "48+", sublabel: "F-14A/B, Su-24M, Kowsar", position: "bottom-right" },
      ],
      post_delay: 1500,
    },

    {
      id:       "isfahan-satellite",
      scenario: "isfahan",
      title:    "OVERWATCH SCAN IN PROGRESS",
      narration: "Horizon Watch satellite overwatch pass is now active. Our synthetic aperture radar is performing a systematic sweep of the facility from west to east, building a composite image at sub-metre resolution. The scan reveals heat signatures consistent with recently started aircraft engines across the southern flight line. Multiple vehicles are moving between the hardened shelters. This pattern of activity — simultaneous aircraft preparation across multiple shelters — has not been observed in the previous ninety days of baseline imagery.",
      center:   [32.614, 51.697], zoom: 16, duration: 3000,
      scene_elements: [
        {
          type: "overwatch_scan",
          bounds: [[32.605, 51.675], [32.622, 51.718]],
          color: "#38bdf8",
          label: "SAR OVERWATCH — SUB-METRE RESOLUTION",
          interactive: true,
        },
        { type: "data_callout", label: "SAR RESOLUTION", value: "0.5m",   sublabel: "Synthetic aperture radar active",   position: "top-right" },
        { type: "data_callout", label: "HEAT SIGNATURES", value: "12+",   sublabel: "aircraft engines running",           position: "bottom-right" },
      ],
      post_delay: 2000,
    },

    {
      id:       "isfahan-detections",
      scenario: "isfahan",
      title:    "AUTOMATED DETECTION: 23 OBJECTS",
      narration: "Horizon Watch automated imagery analysis has completed object detection across the Isfahan apron. Our convolutional neural network has identified twenty-three discrete objects of interest, including eleven fighter-class aircraft on the open apron, four transporter-erector-launchers in the northern compound, six fuel bowsers indicating imminent sortie preparation, and two previously undetected structures assessed as mobile command posts. This concentration of sortie-ready aircraft is anomalous and warrants immediate escalation.",
      center:   [32.614, 51.697], zoom: 17, duration: 3000,
      scene_elements: [
        {
          type: "detection_boxes",
          detections: [
            // Fighter aircraft — southern flight line
            { lat: 32.606, lng: 51.685, w: 0.0012, h: 0.0006, label: "F-14A",   color: "#ef4444", confidence: 94 },
            { lat: 32.607, lng: 51.689, w: 0.0012, h: 0.0006, label: "F-14A",   color: "#ef4444", confidence: 91 },
            { lat: 32.608, lng: 51.693, w: 0.0012, h: 0.0006, label: "F-14B",   color: "#ef4444", confidence: 88 },
            { lat: 32.606, lng: 51.697, w: 0.0012, h: 0.0006, label: "F-14A",   color: "#ef4444", confidence: 96 },
            { lat: 32.607, lng: 51.701, w: 0.0012, h: 0.0006, label: "Su-24M",  color: "#f97316", confidence: 87 },
            { lat: 32.608, lng: 51.705, w: 0.0012, h: 0.0006, label: "Su-24M",  color: "#f97316", confidence: 85 },
            { lat: 32.609, lng: 51.709, w: 0.0012, h: 0.0006, label: "Kowsar",  color: "#f59e0b", confidence: 79 },
            { lat: 32.610, lng: 51.713, w: 0.0012, h: 0.0006, label: "Kowsar",  color: "#f59e0b", confidence: 82 },
            { lat: 32.606, lng: 51.717, w: 0.0012, h: 0.0006, label: "F-14A",   color: "#ef4444", confidence: 93 },
            { lat: 32.607, lng: 51.721, w: 0.0012, h: 0.0006, label: "Su-24M",  color: "#f97316", confidence: 86 },
            { lat: 32.608, lng: 51.725, w: 0.0012, h: 0.0006, label: "F-14B",   color: "#ef4444", confidence: 90 },
            // TEL vehicles — northern compound
            { lat: 32.635, lng: 51.685, w: 0.0016, h: 0.0008, label: "TEL",     color: "#ef4444", confidence: 78 },
            { lat: 32.637, lng: 51.693, w: 0.0016, h: 0.0008, label: "TEL",     color: "#ef4444", confidence: 81 },
            { lat: 32.636, lng: 51.701, w: 0.0016, h: 0.0008, label: "TEL",     color: "#ef4444", confidence: 76 },
            { lat: 32.638, lng: 51.709, w: 0.0016, h: 0.0008, label: "TEL",     color: "#ef4444", confidence: 83 },
            // Fuel bowsers — apron
            { lat: 32.615, lng: 51.688, w: 0.0008, h: 0.0005, label: "BOWSER",  color: "#f59e0b", confidence: 95 },
            { lat: 32.616, lng: 51.696, w: 0.0008, h: 0.0005, label: "BOWSER",  color: "#f59e0b", confidence: 97 },
            { lat: 32.617, lng: 51.704, w: 0.0008, h: 0.0005, label: "BOWSER",  color: "#f59e0b", confidence: 94 },
            { lat: 32.615, lng: 51.712, w: 0.0008, h: 0.0005, label: "BOWSER",  color: "#f59e0b", confidence: 96 },
            { lat: 32.616, lng: 51.720, w: 0.0008, h: 0.0005, label: "BOWSER",  color: "#f59e0b", confidence: 93 },
            { lat: 32.617, lng: 51.728, w: 0.0008, h: 0.0005, label: "BOWSER",  color: "#f59e0b", confidence: 95 },
            // Mobile command posts — undetected structures
            { lat: 32.628, lng: 51.694, w: 0.0014, h: 0.0007, label: "CMD POST", color: "#a855f7", confidence: 71 },
            { lat: 32.629, lng: 51.714, w: 0.0014, h: 0.0007, label: "CMD POST", color: "#a855f7", confidence: 68 },
          ],
        },
        { type: "data_callout", label: "DETECTIONS",   value: "23",   sublabel: "objects of interest identified",   position: "bottom-right" },
        { type: "data_callout", label: "CONFIDENCE",   value: "≥68%", sublabel: "CNN classification threshold",     position: "top-right" },
      ],
      post_delay: 2000,
    },

    {
      id:       "isfahan-analysis",
      scenario: "isfahan",
      title:    "INTELLIGENCE ASSESSMENT",
      narration: "Horizon Watch has completed its automated assessment of the Isfahan Air Base activity. Comparing today's sortie-ready aircraft count against the ninety-day baseline, we observe an anomaly score of four point seven standard deviations above normal. The combination of open-apron fighters, fuelling activity, and transporter-erector-launcher deployment constitutes a pre-strike indicator pattern. Our threat probability model assigns a sixty-eight percent likelihood of offensive air operations within the next twenty-four hours. This intelligence has been packaged and transmitted to partner agencies. Horizon Watch continues its watch.",
      center:   [32.619, 51.700], zoom: 12, duration: 3500,
      scene_elements: [
        {
          type: "chart",
          title: "SORTIE-READY AIRCRAFT — 90-DAY COMPARISON",
          bars: [
            { label: "90-day avg", value: 4,  color: "#3b82f6" },
            { label: "30-day avg", value: 6,  color: "#60a5fa" },
            { label: "7-day avg",  value: 9,  color: "#f59e0b" },
            { label: "TODAY",      value: 11, color: "#ef4444" },
          ],
          unit: "aircraft",
          anomaly: "4.7σ above baseline",
        },
        { type: "spotlight", lat: 32.619, lng: 51.697, radius: 8000, color: "#ef4444" },
        { type: "data_callout", label: "THREAT PROBABILITY", value: "68%",  sublabel: "offensive ops within 24 hrs",     position: "bottom-right", color: "#ef4444" },
        { type: "data_callout", label: "ANOMALY SCORE",      value: "4.7σ", sublabel: "above 90-day baseline",          position: "top-right",    color: "#f59e0b" },
      ],
      next_scene: "scenario4-intro",
      post_delay: 3000,
    },

    // ══════════════════════════════════════════════════════════════════════════
    // SCENARIO 4: SUBMARINE CABLE THREAT — RED SEA / EASSY CABLE
    // ══════════════════════════════════════════════════════════════════════════

    {
      id:       "scenario4-intro",
      scenario: "cable",
      title:    "INFRASTRUCTURE THREAT — RED SEA",
      narration: "Horizon Watch continuously monitors global undersea infrastructure. Our systems have detected an anomaly in the Red Sea that warrants immediate attention. A vessel of interest has been exhibiting behaviour consistent with submarine cable interference near a critical communications node.",
      center:   [15, 42], zoom: 6, duration: 3000,
      scene_elements: [
        { type: "spotlight", lat: 12.6, lng: 43.5, radius: 200000, color: "#f59e0b" },
        { type: "data_callout", label: "ALERT TYPE",   value: "INFRA",    sublabel: "Critical subsea infrastructure", position: "bottom-right" },
        { type: "data_callout", label: "CABLE AT RISK", value: "EASSy",   sublabel: "Eastern Africa Submarine System", position: "top-right" },
      ],
      post_delay: 1000,
    },

    {
      id:       "cable-detection",
      scenario: "cable",
      title:    "ANOMALOUS VESSEL BEHAVIOUR",
      narration: "Horizon Watch has flagged the merchant vessel Iran Explorer, registered in Tehran, which has been stationary for the past six hours directly above the EASSy submarine cable. The vessel transited through the Bab el-Mandeb strait before anchoring precisely over the cable route near the Yemeni coast. The Eastern Africa Submarine System carries forty percent of East Africa's internet traffic and connects fourteen countries. This behaviour pattern matches known cable interference tactics used in previous incidents in the North Sea and Baltic.",
      center:   [12.5, 47.5], zoom: 7, duration: 2500,
      scene_elements: [
        {
          type: "cable_from_db",
          cable_name: "EASSy",
          color: "#a855f7", label: "EASSy Cable", weight: 3,
        },
        { type: "chokepoint_from_db", chokepoint_name: "Bab el-Mandeb", color: "#f59e0b", label: "Bab el-Mandeb" },
        {
          type: "ship_animation",
          vessels: [{
            name: "MV Iran Explorer",
            color: "#ef4444", icon: "cargo",
            speed_knots: 14,
            path: [
              [14.99, 59.02],
              [14.53, 54.75],
              [13.98, 51.38],
              [13.11, 48.52],
              [12.13, 48.81],
              [11.89, 48.09],
              [12.83, 47.75],
              [12.54, 46.91],
              [11.63, 47.23],
              [11.34, 46.42],
              [12.35, 46.25],
            ],
          }],
        },
        { type: "spotlight", lat: 12.35, lng: 46.25, radius: 4000, color: "#ef4444" },
        { type: "facility_marker", name: "MV Iran Explorer", lat: 12.35, lng: 46.25, color: "#ef4444", description: "Stationary 6 hrs over EASSy cable — suspicious", image_query: "Cargo ship" },
        { type: "data_callout", label: "STATIONARY DURATION", value: "6 hrs",  sublabel: "directly over cable route",  position: "bottom-right", color: "#ef4444" },
        { type: "data_callout", label: "CABLE TRAFFIC",        value: "40%",   sublabel: "of East Africa internet",    position: "bottom-center" },
      ],
      post_delay: 2000,
    },

    {
      id:       "cable-impact",
      scenario: "cable",
      title:    "IMPACT ASSESSMENT",
      narration: "Horizon Watch has modelled the potential impact of an EASSy cable disruption. Fourteen countries would experience degraded internet connectivity. Critical services affected include banking systems in Kenya and Tanzania, maritime traffic control in Djibouti, and humanitarian coordination networks across Somalia and South Sudan. Estimated economic impact: forty-seven million dollars per day of outage. Our systems recommend immediate naval investigation.",
      center:   [5, 40], zoom: 5, duration: 2500,
      scene_elements: [
        { type: "country_highlight", name: "kenya",       color: "#f59e0b" },
        { type: "country_highlight", name: "tanzania",    color: "#f59e0b" },
        { type: "country_highlight", name: "somalia",     color: "#f59e0b" },
        { type: "country_highlight", name: "djibouti",    color: "#f59e0b" },
        { type: "country_highlight", name: "south sudan", color: "#f59e0b" },
        { type: "country_highlight", name: "mozambique",  color: "#f59e0b" },
        {
          type: "chart",
          title: "AFFECTED COUNTRIES — EASSY DEPENDENCY",
          bars: [
            { label: "Djibouti",   value: 90, color: "#ef4444" },
            { label: "Kenya",      value: 85, color: "#f59e0b" },
            { label: "Tanzania",   value: 72, color: "#f59e0b" },
            { label: "Mozambique", value: 65, color: "#f59e0b" },
            { label: "Somalia",    value: 45, color: "#f59e0b" },
          ],
          unit: "% internet via EASSy",
          anomaly: null,
        },
        { type: "data_callout", label: "ECONOMIC IMPACT", value: "$47M", sublabel: "per day of outage", position: "bottom-right", color: "#ef4444" },
      ],
      post_delay: 2000,
    },

    {
      id:       "cable-decision",
      scenario: "cable",
      title:    "RESPONSE OPTIONS",
      narration: "Horizon Watch recommends immediate action to protect critical undersea infrastructure. Three response options are available.",
      center:   [12.35, 46.25], zoom: 10, duration: 1500,
      interactive: true,
      choices: [
        { id: "cable-response-air",     label: "Deploy P-8 Poseidon maritime patrol",      icon: "✈" },
        { id: "cable-response-naval",   label: "Redirect USS Farragut for investigation",   icon: "⚓" },
        { id: "cable-response-monitor", label: "Alert cable operator and monitor",          icon: "📡" },
      ],
      scene_elements: [
        { type: "spotlight", lat: 12.35, lng: 46.25, radius: 8000, color: "#f59e0b" },
        { type: "data_callout", label: "DECISION REQUIRED", value: "NOW", sublabel: "Select response", position: "bottom-center", color: "#f59e0b" },
      ],
      post_delay: 0,
    },

    {
      id:       "cable-response-air",
      scenario: "cable",
      title:    "MARITIME PATROL DEPLOYED",
      narration: "A P-8A Poseidon maritime patrol aircraft has been launched from Camp Lemonnier in Djibouti. The aircraft will conduct a low-altitude pass over the vessel to document activities and deploy sonobuoys to monitor subsurface activity near the cable. Horizon Watch will provide the crew with real-time tracking data and historical patterns for the vessel.",
      center:   [11.55, 43.15], zoom: 8, duration: 2500,
      scene_elements: [
        { type: "facility_marker", name: "Camp Lemonnier", lat: 11.55, lng: 43.15, color: "#3b82f6", description: "US Naval Expeditionary Base — Djibouti", image_query: "P-8 Poseidon aircraft" },
        {
          type: "flight_animation",
          aircraft: [{
            name: "Triton 01 (P-8A)",
            color: "#3b82f6", icon: "patrol",
            speed_kmh: 900,
            path: [[11.55,43.15],[11.80,44.50],[12.00,45.50],[12.20,46.00],[12.35,46.25],[12.55,46.40],[12.30,46.50],[12.15,46.20],[12.35,46.25]],
          }],
        },
        { type: "data_callout", label: "TIME ON STATION", value: "22 min", sublabel: "P-8A Poseidon from Camp Lemonnier", position: "bottom-right" },
      ],
      next_scene: "cable-resolution",
      post_delay: 2000,
    },

    {
      id:       "cable-response-naval",
      scenario: "cable",
      title:    "DESTROYER REDIRECTED",
      narration: "USS Farragut, an Arleigh Burke-class destroyer currently operating in the Gulf of Aden, has been redirected to investigate. The ship will establish a presence within visual range of the suspect vessel and deploy its rigid-hull inflatable boats for close inspection if necessary. Estimated arrival: ninety minutes.",
      center:   [12.5, 44.5], zoom: 8, duration: 2500,
      scene_elements: [
        { type: "facility_marker", name: "USS Farragut (DDG-99)", lat: 13.2, lng: 48.0, color: "#3b82f6", description: "Arleigh Burke-class destroyer", image_query: "Arleigh Burke destroyer" },
        {
          type: "ship_animation",
          vessels: [{
            name: "USS Farragut (DDG-99)",
            color: "#3b82f6", icon: "destroyer",
            speed_knots: 30,
            path: [[13.2,48.0],[12.8,47.5],[12.5,47.0],[12.35,46.50],[12.35,46.25]],
          }],
        },
        { type: "data_callout", label: "ETA", value: "90 min", sublabel: "USS Farragut (DDG-99)", position: "bottom-right" },
      ],
      next_scene: "cable-resolution",
      post_delay: 2000,
    },

    {
      id:       "cable-response-monitor",
      scenario: "cable",
      title:    "ENHANCED MONITORING",
      narration: "Horizon Watch has alerted the EASSy cable consortium and increased satellite collection frequency over the area. Our systems are now tracking all vessels within ten nautical miles of the cable route. Additionally, we have tasked commercial satellite providers for high-resolution imagery of the vessel's deck to identify any cable-cutting equipment.",
      center:   [12.35, 46.25], zoom: 11, duration: 2000,
      scene_elements: [
        { type: "radius_circle", lat: 12.35, lng: 46.25, radius_nm: 10, color: "#38bdf8", label: "Enhanced monitoring zone" },
        { type: "data_callout", label: "COLLECTION", value: "TASKED", sublabel: "High-res satellite imagery ordered", position: "bottom-right", color: "#38bdf8" },
      ],
      next_scene: "cable-resolution",
      post_delay: 2000,
    },

    {
      id:       "cable-resolution",
      scenario: "cable",
      title:    "SITUATION MONITORED",
      narration: "Horizon Watch will maintain elevated surveillance of the EASSy cable corridor. All vessel movements near submarine cable routes are now being cross-referenced with known threat patterns. This concludes the infrastructure threat scenario.",
      center:   [12.35, 46.25], zoom: 9, duration: 2000,
      scene_elements: [
        { type: "data_callout", label: "STATUS", value: "MONITORING", sublabel: "Enhanced surveillance active", position: "bottom-center", color: "#f59e0b" },
      ],
      next_scene: "scenario5-intro",
      post_delay: 1500,
    },

    // ══════════════════════════════════════════════════════════════════════════
    // SCENARIO 5: HUMANITARIAN CRISIS — SUDAN
    // ══════════════════════════════════════════════════════════════════════════

    {
      id:       "scenario5-intro",
      scenario: "sudan",
      title:    "HUMANITARIAN CRISIS — SUDAN",
      narration: "For our final scenario, Horizon Watch demonstrates its humanitarian monitoring capability. Sudan's civil war between the Sudanese Armed Forces and the Rapid Support Forces has created one of the world's largest displacement crises. Our systems track population movements, refugee flows, and access to critical infrastructure in real time.",
      center:   [15.6, 32.5], zoom: 6, duration: 3000,
      scene_elements: [
        { type: "country_highlight", name: "sudan", color: "#ef4444" },
        { type: "data_callout", label: "DISPLACED PERSONS", value: "10.7M", sublabel: "internally displaced since April 2023", position: "bottom-right", color: "#ef4444" },
      ],
      post_delay: 1000,
    },

    {
      id:       "sudan-khartoum",
      scenario: "sudan",
      title:    "KHARTOUM — DIVIDED CAPITAL",
      narration: "Horizon Watch monitoring shows Khartoum remains divided between the warring factions. The Rapid Support Forces, led by Mohamed Hamdan Dagalo — known as Hemedti — control most of western Khartoum and the bridges across the Nile. The Sudanese Armed Forces under General Abdel Fattah al-Burhan hold the eastern districts. Civilian infrastructure has been devastated. Our systems detect that eighty-five percent of hospitals in Greater Khartoum are non-functional.",
      center:   [15.60, 32.55], zoom: 13, duration: 2500,
      scene_elements: [
        { type: "facility_marker", name: "Khartoum",                    lat: 15.60, lng: 32.55, color: "#ef4444",  description: "Capital city — active urban combat",      image_query: "Khartoum Sudan" },
        { type: "facility_marker", name: "Gen. Abdel Fattah al-Burhan", lat: 15.61, lng: 32.58, color: "#3b82f6",  description: "SAF Commander — controls eastern Khartoum", image_query: "Abdel Fattah al-Burhan" },
        { type: "facility_marker", name: "Mohamed Dagalo (Hemedti)",    lat: 15.59, lng: 32.48, color: "#ef4444",  description: "RSF Commander — controls western Khartoum", image_query: "Hemedti Sudan" },
        {
          type: "intercept_line",
          path: [
            [15.6553, 32.5140],
            [15.6433, 32.5086],
            [15.6346, 32.5074],
            [15.6255, 32.5128],
            [15.6173, 32.5193],
            [15.6159, 32.5322],
            [15.6186, 32.5545],
            [15.6112, 32.5542],
            [15.6095, 32.5521],
            [15.6026, 32.5516],
            [15.6022, 32.5482],
            [15.5986, 32.5467],
            [15.5957, 32.5490],
            [15.5943, 32.5504],
            [15.5912, 32.5502],
            [15.5848, 32.5496],
            [15.5728, 32.5510],
            [15.5602, 32.5535],
            [15.5271, 32.5589],
            [15.5200, 32.5616],
          ],
          color: "#ef4444", weight: 3, dashed: true,
          label: "Front Line — Nile",
          labelWest: "RSF",  colorWest: "#ef4444",
          labelEast: "SAF",  colorEast: "#3b82f6",
          labelOffset: 0.03,
        },
        { type: "data_callout", label: "HOSPITALS FUNCTIONAL", value: "15%", sublabel: "in Greater Khartoum", position: "bottom-right", color: "#ef4444" },
      ],
      post_delay: 2000,
    },

    {
      id:       "sudan-refugees",
      scenario: "sudan",
      title:    "REFUGEE FLOWS",
      narration: "Horizon Watch tracks mass population movements using satellite imagery analysis and partner organisation data. Since the conflict began, over two million refugees have crossed into neighbouring countries. The largest flows are toward Chad with over six hundred thousand arrivals, South Sudan with over five hundred thousand, and Egypt with approximately four hundred thousand. Our systems identify crossing points, camp locations, and supply route disruptions to support humanitarian response coordination.",
      center:   [14, 30], zoom: 5, duration: 2500,
      scene_elements: [
        { type: "country_highlight", name: "sudan",       color: "#ef4444" },
        { type: "country_highlight", name: "chad",        color: "#f59e0b" },
        { type: "country_highlight", name: "south sudan", color: "#f59e0b" },
        { type: "country_highlight", name: "egypt",       color: "#f59e0b" },
        {
          type: "flow_arrows",
          flows: [
            { from: [13.5,28.0], to: [13.0,21.0], label: "620K → Chad",     color: "#f59e0b", width: 5 },
            { from: [11.0,32.0], to: [ 7.0,31.5], label: "510K → S.Sudan",  color: "#f59e0b", width: 4 },
            { from: [18.0,33.0], to: [24.0,33.0], label: "400K → Egypt",    color: "#f59e0b", width: 3 },
            { from: [15.0,36.0], to: [15.5,39.0], label: "120K → Eritrea",  color: "#f59e0b", width: 2 },
          ],
        },
        {
          type: "chart",
          title: "REFUGEE ARRIVALS BY COUNTRY",
          bars: [
            { label: "Chad",    value: 620, color: "#f59e0b" },
            { label: "S.Sudan", value: 510, color: "#f59e0b" },
            { label: "Egypt",   value: 400, color: "#f59e0b" },
            { label: "Eritrea", value: 120, color: "#f59e0b" },
            { label: "Ethiopia",value:  95, color: "#f59e0b" },
          ],
          unit: "thousands of arrivals",
          anomaly: null,
        },
        { type: "data_callout", label: "TOTAL REFUGEES", value: "2.1M+", sublabel: "fled Sudan since April 2023", position: "bottom-right", color: "#ef4444" },
      ],
      next_scene: "finale-global",
      post_delay: 2500,
    },

    // ══════════════════════════════════════════════════════════════════════════
    // FINALE
    // ══════════════════════════════════════════════════════════════════════════

    {
      id:       "finale-global",
      scenario: "finale",
      title:    "GLOBAL THREAT MATRIX",
      narration: "This concludes the Horizon Watch capability demonstration. In the past minutes you have seen our platform detect maritime threats in real time, provide tactical defence planning for ground operations, analyse satellite imagery with machine learning, monitor critical infrastructure, and track humanitarian crises. Horizon Watch processes data from over two hundred seventy news sources, tracks thousands of vessels via AIS, monitors aircraft with ADS-B, and integrates satellite imagery analysis. Every layer of intelligence, visible on one unified platform. Horizon Watch. See everything.",
      center:   [20, 30], zoom: 3, duration: 4000,
      scene_elements: [
        { type: "spotlight", lat: 26.56, lng: 56.25, radius: 80000, color: "#ef4444" },
        { type: "spotlight", lat: 16.27, lng: -0.05, radius: 80000, color: "#ef4444" },
        { type: "spotlight", lat: 32.62, lng: 51.70, radius: 80000, color: "#f59e0b" },
        { type: "spotlight", lat: 13.20, lng: 43.50, radius: 80000, color: "#a855f7" },
        { type: "spotlight", lat: 15.60, lng: 32.55, radius: 80000, color: "#ef4444" },
        { type: "data_callout", label: "HORIZON WATCH", value: "SEE EVERYTHING", sublabel: "", position: "bottom-center", color: "#38bdf8" },
      ],
      post_delay: 3000,
    },

  ],
}
