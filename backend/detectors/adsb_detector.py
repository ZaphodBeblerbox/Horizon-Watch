from datetime import datetime

MILITARY_PREFIXES = {
    # Original
    "RCH", "SAM", "AIO", "JAKE", "RAGN", "UAVGH", "FORTE", "DOOM",
    "GRZLY", "INTEL", "SPAR", "PAT", "MOOSE", "VIPER", "HERK",
    # Extended
    "LAGR", "DUKE", "TOPGUN", "ATLAS", "FURY", "GHOST", "REAPER",
    "SIGINT", "AWACS", "COBRA", "IRON", "REACH", "KNIFE",
    "CNV", "RRR", "NATO", "USAF", "RAF", "FRAF",
}

MILITARY_SQUAWKS = {"7500", "7600", "7700", "1234", "2777", "6100", "6200", "7001", "7777"}

MILITARY_AIRCRAFT_TYPES = {
    'E-3', 'E-8', 'RC-135', 'P-8', 'EP-3', 'U-2', 'RQ-4', 'MQ-9',
    'E-7', 'C-17', 'C-130', 'KC-135', 'KC-46', 'B-52', 'B-1', 'B-2',
    'F-15', 'F-16', 'F-22', 'F-35', 'Typhoon', 'Rafale', 'Gripen',
    'Sentinel', 'Shadow', 'Wedgetail', 'Rivet Joint', 'Joint STARS',
}

AIRCRAFT_TYPE_IMAGES = {
    'RC-135':      'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/RC-135V_Rivet_Joint.jpg/320px-RC-135V_Rivet_Joint.jpg',
    'P-8':         'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Boeing_P-8A_Poseidon.jpg/320px-Boeing_P-8A_Poseidon.jpg',
    'E-3':         'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/E-3_Sentry_AWACS.jpg/320px-E-3_Sentry_AWACS.jpg',
    'RQ-4':        'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/RQ-4A_Global_Hawk.jpg/320px-RQ-4A_Global_Hawk.jpg',
    'MQ-9':        'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/MQ-9_Reaper_UAV.jpg/320px-MQ-9_Reaper_UAV.jpg',
    'U-2':         'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/U-2_High_Altitude_Reconnaissance.jpg/320px-U-2_High_Altitude_Reconnaissance.jpg',
    'B-52':        'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/B-52_Stratofortress.jpg/320px-B-52_Stratofortress.jpg',
    'B-2':         'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/B-2_Spirit.jpg/320px-B-2_Spirit.jpg',
    'F-35':        'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/F-35A_Lightning_II.jpg/320px-F-35A_Lightning_II.jpg',
    'C-17':        'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/C-17_Globemaster_III.jpg/320px-C-17_Globemaster_III.jpg',
    'KC-135':      'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/KC-135_Stratotanker.jpg/320px-KC-135_Stratotanker.jpg',
    'E-7':         'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/E-7A_Wedgetail.jpg/320px-E-7A_Wedgetail.jpg',
}
AIRCRAFT_IMAGE_FALLBACK = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Military_aircraft_silhouette.jpg/320px-Military_aircraft_silhouette.jpg'

# Rolling 20-position track buffer per ICAO hex — maintained externally by main.py
_military_tracks: dict = {}  # icao_hex → [{"lat","lon","alt","speed","heading","ts"}, ...]


def _resolve_aircraft_image(aircraft_type: str | None) -> str:
    if not aircraft_type:
        return AIRCRAFT_IMAGE_FALLBACK
    for key in AIRCRAFT_TYPE_IMAGES:
        if key.lower() in (aircraft_type or "").lower():
            return AIRCRAFT_TYPE_IMAGES[key]
    return AIRCRAFT_IMAGE_FALLBACK


def _detect_aircraft_type(aircraft_type_str: str | None) -> str | None:
    if not aircraft_type_str:
        return None
    for t in MILITARY_AIRCRAFT_TYPES:
        if t.lower() in aircraft_type_str.lower():
            return t
    return None


class ADSBPatternDetector:
    """Rule-based ADS-B aircraft anomaly detection."""

    def check_aircraft(self, aircraft, military_callsigns=None):
        alerts = []
        callsign     = (aircraft.get("flight") or "").strip()
        icao_hex     = (aircraft.get("hex") or aircraft.get("icao") or "").upper()
        lat          = aircraft.get("lat")
        lon          = aircraft.get("lon") or aircraft.get("lng")
        alt          = aircraft.get("alt_baro")
        speed        = aircraft.get("gs")
        heading      = aircraft.get("track")
        aircraft_type_raw = aircraft.get("type") or aircraft.get("category") or ""
        squawk       = str(aircraft.get("squawk", ""))
        is_military_flag = bool(aircraft.get("military"))

        prefixes = set(military_callsigns or MILITARY_PREFIXES)
        callsign_match = any(callsign.upper().startswith(p) for p in prefixes)
        squawk_match   = squawk in MILITARY_SQUAWKS
        type_match     = _detect_aircraft_type(aircraft_type_raw)
        is_military    = is_military_flag or callsign_match or bool(type_match)

        # Update rolling track buffer for all military aircraft
        if is_military and icao_hex and lat and lon:
            track = _military_tracks.setdefault(icao_hex, [])
            track.append({
                "lat": lat, "lon": lon, "alt": alt,
                "speed": speed, "heading": heading,
                "ts": datetime.utcnow().isoformat(),
            })
            _military_tracks[icao_hex] = track[-20:]

        if callsign_match or is_military_flag or type_match:
            aircraft_image = _resolve_aircraft_image(type_match or aircraft_type_raw)
            alerts.append({
                "type":               "military_aircraft",
                "alert_category":     "MILITARY_AIRCRAFT",
                "source":             "ADSB",
                "domain":             "ADSB",
                "severity":           "high",
                "aircraft":           callsign,
                "icao":               icao_hex,
                "icao_hex":           icao_hex,
                "aircraft_type":      type_match or aircraft_type_raw or None,
                "aircraft_image_url": aircraft_image,
                "lat":                lat,
                "lng":                lon,
                "altitude":           alt,
                "speed":              speed,
                "heading":            heading,
                "track_points":       list(_military_tracks.get(icao_hex, [])),
                "message":            f"Military aircraft: {callsign or icao_hex}",
                "title":              f"Military Aircraft: {callsign or icao_hex}",
                "timestamp":          datetime.utcnow().isoformat(),
            })

        if squawk_match and squawk in ("7500", "7600", "7700"):
            labels = {"7500": "HIJACK", "7600": "COMMS FAILURE", "7700": "EMERGENCY"}
            alerts.append({
                "type":      "emergency_squawk",
                "source":    "ADSB",
                "domain":    "ADSB",
                "severity":  "critical",
                "aircraft":  callsign,
                "squawk":    squawk,
                "lat":       lat,
                "lng":       lon,
                "message":   f"{labels[squawk]}: {callsign or icao_hex} squawking {squawk}",
                "title":     f"{labels[squawk]}: {callsign or icao_hex}",
                "timestamp": datetime.utcnow().isoformat(),
            })
        elif squawk_match and squawk not in ("7500", "7600", "7700"):
            alerts.append({
                "type":      "military_squawk",
                "alert_category": "MILITARY_AIRCRAFT",
                "source":    "ADSB",
                "domain":    "ADSB",
                "severity":  "high",
                "aircraft":  callsign,
                "squawk":    squawk,
                "lat":       lat,
                "lng":       lon,
                "message":   f"Military squawk {squawk}: {callsign or icao_hex}",
                "title":     f"Military Squawk {squawk}: {callsign or icao_hex}",
                "timestamp": datetime.utcnow().isoformat(),
            })

        return alerts
