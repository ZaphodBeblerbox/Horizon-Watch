/**
 * directorImages.js — Hardcoded Wikimedia Commons image URLs for Director Mode.
 * Checked first (before backend/Wikipedia API) so common entities always resolve instantly.
 * Keys are lowercase substrings — longer/more-specific keys match before shorter ones.
 */

export const DIRECTOR_IMAGES = {
  // ── Military vessels ────────────────────────────────────────────────────────
  'irgc fast attack craft':   'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Tondar_class_fast_attack_craft.jpg/300px-Tondar_class_fast_attack_craft.jpg',
  'tondar class':             'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Tondar_class_fast_attack_craft.jpg/300px-Tondar_class_fast_attack_craft.jpg',
  'irgc navy':                'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Tondar_class_fast_attack_craft.jpg/300px-Tondar_class_fast_attack_craft.jpg',
  'arleigh burke':            'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/US_Navy_050715-N-8163B-009_The_guided_missile_destroyer_USS_Fitzgerald_%28DDG_62%29.jpg/300px-US_Navy_050715-N-8163B-009_The_guided_missile_destroyer_USS_Fitzgerald_%28DDG_62%29.jpg',
  'nimitz class':             'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/USS_Abraham_Lincoln_%28CVN-72%29_closeup.jpg/300px-USS_Abraham_Lincoln_%28CVN-72%29_closeup.jpg',
  'aircraft carrier':         'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/USS_Abraham_Lincoln_%28CVN-72%29_closeup.jpg/300px-USS_Abraham_Lincoln_%28CVN-72%29_closeup.jpg',
  'submarine':                'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/USS_Virginia_%28SSN-774%29.jpg/300px-USS_Virginia_%28SSN-774%29.jpg',
  'oil tanker':               'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Oil_tanker_AbQaiq.jpg/300px-Oil_tanker_AbQaiq.jpg',
  'container ship':           'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/CMA_CGM_Christophe_Colomb.jpg/300px-CMA_CGM_Christophe_Colomb.jpg',

  // ── Aircraft ─────────────────────────────────────────────────────────────────
  'mq-9 reaper':              'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/MQ-9_Reaper_-_090609-F-0000M-777.JPG/300px-MQ-9_Reaper_-_090609-F-0000M-777.JPG',
  'p-8 poseidon':             'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/P-8A_Poseidon_VX-1.jpg/300px-P-8A_Poseidon_VX-1.jpg',
  'f-35':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/F-35A_flight_%28cropped%29.jpg/300px-F-35A_flight_%28cropped%29.jpg',
  'f-16':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/F-16_June_2008.jpg/300px-F-16_June_2008.jpg',
  'b-52':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/B-52H_static_display_arms_702.jpg/300px-B-52H_static_display_arms_702.jpg',
  'su-35':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Sukhoi_Su-35S_in_2009.jpg/300px-Sukhoi_Su-35S_in_2009.jpg',
  'surveillance flight':      'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/MQ-9_Reaper_-_090609-F-0000M-777.JPG/300px-MQ-9_Reaper_-_090609-F-0000M-777.JPG',
  'drone strike':             'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/MQ-9_Reaper_-_090609-F-0000M-777.JPG/300px-MQ-9_Reaper_-_090609-F-0000M-777.JPG',
  'shahed':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Shahed_136.jpg/300px-Shahed_136.jpg',
  'helicopter':               'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/AH-64D_Apache_Longbow.jpg/300px-AH-64D_Apache_Longbow.jpg',
  'mirage 2000':              'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Dassault_Mirage_2000C_Armee_de_lair.jpg/300px-Dassault_Mirage_2000C_Armee_de_lair.jpg',
  'mirage 2000d':             'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Dassault_Mirage_2000C_Armee_de_lair.jpg/300px-Dassault_Mirage_2000C_Armee_de_lair.jpg',
  'barkhane':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Dassault_Mirage_2000C_Armee_de_lair.jpg/300px-Dassault_Mirage_2000C_Armee_de_lair.jpg',

  // ── Missiles & weapons ───────────────────────────────────────────────────────
  'shahab-3':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Shahab-3_Range.jpg/220px-Shahab-3_Range.jpg',
  'tomahawk':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Tomahawk_Block_IV_cruise_missile.jpg/300px-Tomahawk_Block_IV_cruise_missile.jpg',
  'cruise missile':           'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Tomahawk_Block_IV_cruise_missile.jpg/300px-Tomahawk_Block_IV_cruise_missile.jpg',
  'anti-ship missile':        'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Harpoon_surface_to_surface.jpg/300px-Harpoon_surface_to_surface.jpg',
  'ballistic missile':        'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Shahab-3_Range.jpg/220px-Shahab-3_Range.jpg',
  'himars':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/HIMARS_-_missile_launched.jpg/300px-HIMARS_-_missile_launched.jpg',
  'iron dome':                'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Iron_Dome_near_Sderot.jpg/300px-Iron_Dome_near_Sderot.jpg',
  's-400':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/S-400_Triumf.jpg/300px-S-400_Triumf.jpg',
  'patriot missile':          'https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Patriot_missile_launch.jpg/300px-Patriot_missile_launch.jpg',
  'artillery':                'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/M777_Light_Towed_Howitzer.jpg/300px-M777_Light_Towed_Howitzer.jpg',
  'tank':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/M1A2_Abrams_Tank.jpg/300px-M1A2_Abrams_Tank.jpg',
  't-72':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/T-72B3_tank.jpg/300px-T-72B3_tank.jpg',

  // ── World leaders ────────────────────────────────────────────────────────────
  'vladimir putin':           'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Vladimir_Putin_official_portrait.jpg/220px-Vladimir_Putin_official_portrait.jpg',
  'volodymyr zelenskyy':      'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Volodymyr_Zelensky_official_portrait.jpg/220px-Volodymyr_Zelensky_official_portrait.jpg',
  'zelensky':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Volodymyr_Zelensky_official_portrait.jpg/220px-Volodymyr_Zelensky_official_portrait.jpg',
  'donald trump':             'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Donald_Trump_official_portrait.jpg/220px-Donald_Trump_official_portrait.jpg',
  'xi jinping':               'https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Xi_Jinping_2019.jpg/220px-Xi_Jinping_2019.jpg',
  'ali khamenei':             'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Ali_Khamenei_crop.jpg/220px-Ali_Khamenei_crop.jpg',
  'khamenei':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Ali_Khamenei_crop.jpg/220px-Ali_Khamenei_crop.jpg',
  'benjamin netanyahu':       'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Benjamin_Netanyahu_2023.jpg/220px-Benjamin_Netanyahu_2023.jpg',
  'netanyahu':                'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Benjamin_Netanyahu_2023.jpg/220px-Benjamin_Netanyahu_2023.jpg',
  'abdel fattah el-sisi':     'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Abdel_Fattah_el-Sisi.jpg/220px-Abdel_Fattah_el-Sisi.jpg',
  'mohammed bin salman':      'https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Mohammad_bin_Salman.jpg/220px-Mohammad_bin_Salman.jpg',
  'recep tayyip erdogan':     'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Recep_Tayyip_Erdogan_2023.jpg/220px-Recep_Tayyip_Erdogan_2023.jpg',
  'erdogan':                  'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Recep_Tayyip_Erdogan_2023.jpg/220px-Recep_Tayyip_Erdogan_2023.jpg',
  'emmanuel macron':          'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Emmanuel_Macron_2022.jpg/220px-Emmanuel_Macron_2022.jpg',
  'assimi goita':             'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Assimi_Go%C3%AFta_in_2023.jpg/220px-Assimi_Go%C3%AFta_in_2023.jpg',
  'abdel-fattah al-burhan':   'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Abdel_Fattah_al-Burhan.jpg/220px-Abdel_Fattah_al-Burhan.jpg',
  'hemedti':                  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Hemetti_2019.jpg/220px-Hemetti_2019.jpg',
  'dagalo':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Hemetti_2019.jpg/220px-Hemetti_2019.jpg',
  'bashar al-assad':          'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Bashar_al-Assad_in_2023.jpg/220px-Bashar_al-Assad_in_2023.jpg',
  'hassan nasrallah':         'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Hassan_Nasrallah.jpg/220px-Hassan_Nasrallah.jpg',
  'yevgeny prigozhin':        'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Yevgeny_Prigozhin_2023.jpg/220px-Yevgeny_Prigozhin_2023.jpg',
  'narendra modi':            'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Narendra_Modi_2023.jpg/220px-Narendra_Modi_2023.jpg',

  // ── Armed groups ─────────────────────────────────────────────────────────────
  'wagner group':             'https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/PMC_Wagner_Group_logo.svg/220px-PMC_Wagner_Group_logo.svg.png',
  'hezbollah':                'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Hezbollah_militants.jpg/300px-Hezbollah_militants.jpg',
  'hamas':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Hamas_parade.jpg/300px-Hamas_parade.jpg',
  'houthi':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Houthi_fighters.jpg/300px-Houthi_fighters.jpg',
  'rapid support forces':     'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Hemetti_2019.jpg/220px-Hemetti_2019.jpg',
  'rsf ':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Hemetti_2019.jpg/220px-Hemetti_2019.jpg',
  'al-shabaab':               'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Mujahideen_in_formation.jpg/300px-Mujahideen_in_formation.jpg',
  'boko haram':               'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Mujahideen_in_formation.jpg/300px-Mujahideen_in_formation.jpg',
  'jnim':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Mujahideen_in_formation.jpg/300px-Mujahideen_in_formation.jpg',
  'al-qaeda':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Mujahideen_in_formation.jpg/300px-Mujahideen_in_formation.jpg',
  'isis':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Technicals_in_Raqqa.jpg/300px-Technicals_in_Raqqa.jpg',
  'islamic state':            'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Technicals_in_Raqqa.jpg/300px-Technicals_in_Raqqa.jpg',
  'm23':                      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Mujahideen_in_formation.jpg/300px-Mujahideen_in_formation.jpg',
  'irgc':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Tondar_class_fast_attack_craft.jpg/300px-Tondar_class_fast_attack_craft.jpg',

  // ── Chokepoints ──────────────────────────────────────────────────────────────
  'strait of hormuz':         'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Strait_of_Hormuz.jpg/300px-Strait_of_Hormuz.jpg',
  'bab el-mandeb':            'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Bab_el_Mandeb.jpg/300px-Bab_el_Mandeb.jpg',
  'suez canal':               'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Suez_Canal_from_ISS.jpg/300px-Suez_Canal_from_ISS.jpg',
  'strait of malacca':        'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Strait_of_malacca.jpg/300px-Strait_of_malacca.jpg',
  'taiwan strait':            'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Taiwan_Strait.jpg/300px-Taiwan_Strait.jpg',
  'bosphorus':                'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Bosphorus.jpg/300px-Bosphorus.jpg',
  'strait of gibraltar':      'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Strait_of_Gibraltar.jpg/300px-Strait_of_Gibraltar.jpg',
  'panama canal':             'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Panama_Canal_Gatun_Locks.jpg/300px-Panama_Canal_Gatun_Locks.jpg',

  // ── Cities ───────────────────────────────────────────────────────────────────
  'bamako':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Bamako_view.jpg/300px-Bamako_view.jpg',
  'khartoum':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Khartoum_Blue_Nile.jpg/300px-Khartoum_Blue_Nile.jpg',
  'goma':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Goma_DRC.jpg/300px-Goma_DRC.jpg',
  'odesa':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Odessa_Opera_House.jpg/300px-Odessa_Opera_House.jpg',
  'odessa':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Odessa_Opera_House.jpg/300px-Odessa_Opera_House.jpg',
  'kyiv':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Kyiv_skyline.jpg/300px-Kyiv_skyline.jpg',
  'kiev':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Kyiv_skyline.jpg/300px-Kyiv_skyline.jpg',
  'gaza':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Gaza_City.jpg/300px-Gaza_City.jpg',
  'mogadishu':                'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Mogadishu_skyline.jpg/300px-Mogadishu_skyline.jpg',
  'camp lemonnier':           'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Camp_Lemonnier%2C_Djibouti.jpg/300px-Camp_Lemonnier%2C_Djibouti.jpg',
  'djibouti':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Camp_Lemonnier%2C_Djibouti.jpg/300px-Camp_Lemonnier%2C_Djibouti.jpg',
  'tehran':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Tehran_skyline.jpg/300px-Tehran_skyline.jpg',
  'bandar abbas':             'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Bandar_Abbas_Port.jpg/300px-Bandar_Abbas_Port.jpg',
  'istanbul':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Istanbul_skyline.jpg/300px-Istanbul_skyline.jpg',
  'cairo':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Cairo_From_Tower.jpg/300px-Cairo_From_Tower.jpg',
  'riyadh':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Riyadh_Skyline.jpg/300px-Riyadh_Skyline.jpg',
  'doha':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Doha_skyline.jpg/300px-Doha_skyline.jpg',
  'dubai':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Dubai_Marina_Skyline.jpg/300px-Dubai_Marina_Skyline.jpg',
  'moscow':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Moscow_Kremlin.jpg/300px-Moscow_Kremlin.jpg',
  'beijing':                  'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Beijing_CBD.jpg/300px-Beijing_CBD.jpg',
  'taipei':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Taipei_skyline.jpg/300px-Taipei_skyline.jpg',
  'jerusalem':                'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Jerusalem_Dome_of_the_rock.jpg/300px-Jerusalem_Dome_of_the_rock.jpg',
  'damascus':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Damascus_Panorama.jpg/300px-Damascus_Panorama.jpg',
  'tripoli':                  'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Tripoli_Libya.jpg/300px-Tripoli_Libya.jpg',
  'benghazi':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Benghazi_waterfront.jpg/300px-Benghazi_waterfront.jpg',
  'aden':                     'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Aden_harbor.jpg/300px-Aden_harbor.jpg',
  'sanaa':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Sanaa_Old_City.jpg/300px-Sanaa_Old_City.jpg',
  'kabul':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Kabul_city.jpg/300px-Kabul_city.jpg',
  'gao':                      'https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Gao_mali.jpg/300px-Gao_mali.jpg',
  'port sudan':               'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Aden_harbor.jpg/300px-Aden_harbor.jpg',
  'abuja':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Abuja_National_Mosque.jpg/300px-Abuja_National_Mosque.jpg',

  // ── Events & infrastructure ──────────────────────────────────────────────────
  'airstrike':                'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/GBU-28_before_impact.jpg/300px-GBU-28_before_impact.jpg',
  'bombing':                  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/GBU-28_before_impact.jpg/300px-GBU-28_before_impact.jpg',
  'explosion':                'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/GBU-28_before_impact.jpg/300px-GBU-28_before_impact.jpg',
  'naval base':               'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Camp_Lemonnier%2C_Djibouti.jpg/300px-Camp_Lemonnier%2C_Djibouti.jpg',
  'military base':            'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Camp_Lemonnier%2C_Djibouti.jpg/300px-Camp_Lemonnier%2C_Djibouti.jpg',
  'refugee camp':             'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Refugee_camp.jpg/300px-Refugee_camp.jpg',
  'humanitarian crisis':      'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Refugee_camp.jpg/300px-Refugee_camp.jpg',
  'displaced persons':        'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Refugee_camp.jpg/300px-Refugee_camp.jpg',
  'rafah':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Rafah_Border_Crossing.jpg/300px-Rafah_Border_Crossing.jpg',
  'border crossing':          'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Rafah_Border_Crossing.jpg/300px-Rafah_Border_Crossing.jpg',
  'peacekeeping':             'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/MONUSCO_peacekeepers.jpg/300px-MONUSCO_peacekeepers.jpg',
  'nuclear':                  'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Bushehr_Nuclear_Power_Plant.jpg/300px-Bushehr_Nuclear_Power_Plant.jpg',
  'oil refinery':             'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Oil_refinery.jpg/300px-Oil_refinery.jpg',
  'pipeline':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Oil_pipeline.jpg/300px-Oil_pipeline.jpg',
  'airport':                  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Dubai_International_Airport.jpg/300px-Dubai_International_Airport.jpg',
  'special forces':           'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/US_Army_soldiers_patrol.jpg/300px-US_Army_soldiers_patrol.jpg',
  'troops':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/US_Army_soldiers_patrol.jpg/300px-US_Army_soldiers_patrol.jpg',
  'siege':                    'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Technicals_in_Raqqa.jpg/300px-Technicals_in_Raqqa.jpg',
  'urban warfare':            'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Technicals_in_Raqqa.jpg/300px-Technicals_in_Raqqa.jpg',
  'election':                 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Ballot_box.jpg/300px-Ballot_box.jpg',
  'piracy':                   'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Pirate_skiff.jpg/300px-Pirate_skiff.jpg',
}

// Sorted once at module load — longer keys match before shorter ones
const _SORTED_KEYS = Object.keys(DIRECTOR_IMAGES).sort((a, b) => b.length - a.length)

/**
 * Check the hardcoded database before hitting the network.
 * Returns a URL string or null.
 */
export function findDirectorImage(query, context = '') {
  if (!query) return null
  const combined = (query + ' ' + context).toLowerCase()
  for (const key of _SORTED_KEYS) {
    if (combined.includes(key)) return DIRECTOR_IMAGES[key]
  }
  return null
}
