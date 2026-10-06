from datetime import datetime

MILITARY_PREFIXES = {
    "RCH", "SAM", "AIO", "JAKE", "RAGN", "UAVGH", "FORTE", "DOOM",
    "GRZLY", "INTEL", "SPAR", "PAT", "MOOSE", "VIPER", "HERK",
}


class ADSBPatternDetector:
    """Rule-based ADS-B aircraft anomaly detection."""

    def check_aircraft(self, aircraft, military_callsigns=None):
        alerts = []
        callsign = (aircraft.get("flight") or "").strip()
        prefix = callsign[:4].upper()

        prefixes = set(military_callsigns or MILITARY_PREFIXES)
        if any(callsign.upper().startswith(p) for p in prefixes):
            alerts.append({
                "type":      "military_aircraft",
                "source":    "ADSB",
                "severity":  "info",
                "aircraft":  callsign,
                "icao":      aircraft.get("hex"),
                "lat":       aircraft.get("lat"),
                "lng":       aircraft.get("lon"),
                "altitude":  aircraft.get("alt_baro"),
                "message":   f"Military aircraft: {callsign}",
                "timestamp": datetime.utcnow().isoformat(),
            })

        squawk = str(aircraft.get("squawk", ""))
        if squawk in ("7500", "7600", "7700"):
            labels = {
                "7500": "HIJACK",
                "7600": "COMMS FAILURE",
                "7700": "EMERGENCY",
            }
            alerts.append({
                "type":      "emergency_squawk",
                "source":    "ADSB",
                "severity":  "critical",
                "aircraft":  callsign,
                "squawk":    squawk,
                "lat":       aircraft.get("lat"),
                "lng":       aircraft.get("lon"),
                # Written in words (notification_context.plain does the same
                # for alerts stored before this): "BAF431 declared an
                # emergency (squawk 7700)", not "EMERGENCY: BAF431 squawking 7700".
                "message":   f"{callsign or aircraft.get('hex','?')} "
                             f"{ {'7700': 'declared an emergency', '7600': 'lost radio contact', '7500': 'signalled a hijacking'}.get(squawk, labels[squawk].lower()) } "
                             f"(squawk {squawk})",
                "timestamp": datetime.utcnow().isoformat(),
            })

        return alerts
