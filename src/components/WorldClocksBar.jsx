import { useState, useEffect } from "react"

const STRATEGIC_CITIES = [
    { name: 'New York',   tz: 'America/New_York',   lat: 40.71,  lon: -74.01  },
    { name: 'London',     tz: 'Europe/London',       lat: 51.51,  lon: -0.13   },
    { name: 'Kyiv',       tz: 'Europe/Kyiv',         lat: 50.45,  lon: 30.52   },
    { name: 'Moscow',     tz: 'Europe/Moscow',       lat: 55.75,  lon: 37.62   },
    { name: 'Tehran',     tz: 'Asia/Tehran',         lat: 35.69,  lon: 51.39   },
    { name: 'Dubai',      tz: 'Asia/Dubai',          lat: 25.20,  lon: 55.27   },
    { name: 'Riyadh',     tz: 'Asia/Riyadh',         lat: 24.69,  lon: 46.72   },
    { name: 'Islamabad',  tz: 'Asia/Karachi',        lat: 33.72,  lon: 73.04   },
    { name: 'Beijing',    tz: 'Asia/Shanghai',       lat: 39.91,  lon: 116.39  },
    { name: 'Pyongyang',  tz: 'Asia/Pyongyang',      lat: 39.02,  lon: 125.75  },
]

const WMO_ICON = {
    0: '☀',
    1: '🌤', 2: '⛅', 3: '☁',
    45: '🌫', 48: '🌫',
    51: '🌦', 61: '🌧', 71: '🌨',
    80: '🌦', 95: '⛈',
}

function getWeatherIcon(code) {
    if (code == null) return '🌡'
    return WMO_ICON[code] || WMO_ICON[Math.floor(code / 10) * 10] || '🌡'
}

export default function WorldClocksBar({ visible }) {
    const [times,   setTimes]   = useState({})
    const [weather, setWeather] = useState({})

    // Tick every second
    useEffect(() => {
        if (!visible) return
        const tick = () => {
            const now = {}
            STRATEGIC_CITIES.forEach(city => {
                try {
                    now[city.name] = new Date().toLocaleTimeString('en-GB', {
                        timeZone: city.tz,
                        hour:     '2-digit',
                        minute:   '2-digit',
                        hour12:   false,
                    })
                } catch (_) {
                    now[city.name] = '--:--'
                }
            })
            setTimes(now)
        }
        tick()
        const t = setInterval(tick, 1_000)
        return () => clearInterval(t)
    }, [visible])

    // Fetch weather from Open-Meteo (free, no key)
    useEffect(() => {
        if (!visible) return

        const fetchWeather = async () => {
            try {
                const lats = STRATEGIC_CITIES.map(c => c.lat).join(',')
                const lons = STRATEGIC_CITIES.map(c => c.lon).join(',')
                const url  = `https://api.open-meteo.com/v1/forecast`
                    + `?latitude=${lats}&longitude=${lons}`
                    + `&current=temperature_2m,weathercode`
                    + `&timezone=UTC`

                const r       = await fetch(url)
                const data    = await r.json()
                const results = Array.isArray(data) ? data : [data]
                const wmap    = {}
                STRATEGIC_CITIES.forEach((city, i) => {
                    const d = results[i]
                    if (d?.current) {
                        wmap[city.name] = {
                            temp: Math.round(d.current.temperature_2m),
                            icon: getWeatherIcon(d.current.weathercode),
                        }
                    }
                })
                setWeather(wmap)
            } catch (e) {
                console.warn('[clocks] weather fetch failed:', e)
            }
        }

        fetchWeather()
        const iv = setInterval(fetchWeather, 30 * 60_000)
        return () => clearInterval(iv)
    }, [visible])

    if (!visible) return null

    return (
        <div style={{
            position:        'fixed',
            top:             0,
            left:            0,
            right:           0,
            height:          36,
            background:      'rgba(5,10,20,0.90)',
            backdropFilter:  'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom:    '1px solid rgba(0,212,255,0.08)',
            zIndex:          150,
            display:         'flex',
            alignItems:      'center',
            overflowX:       'auto',
            scrollbarWidth:  'none',
            fontFamily:      '"IBM Plex Mono", "Courier New", monospace',
        }}>
            {STRATEGIC_CITIES.map(city => {
                const w    = weather[city.name]
                const time = times[city.name] || '--:--'

                return (
                    <div key={city.name} style={{
                        display:    'flex',
                        alignItems: 'center',
                        gap:        6,
                        padding:    '0 14px',
                        borderRight:'1px solid rgba(255,255,255,0.05)',
                        height:     '100%',
                        flexShrink: 0,
                    }}>
                        <span style={{
                            fontSize:      8,
                            fontWeight:    700,
                            color:         'rgba(255,255,255,0.4)',
                            letterSpacing: 1.2,
                            textTransform: 'uppercase',
                        }}>
                            {city.name}
                        </span>
                        <span style={{
                            fontSize:            12,
                            fontWeight:          700,
                            color:               'rgba(255,255,255,0.85)',
                            letterSpacing:       1,
                            fontVariantNumeric:  'tabular-nums',
                        }}>
                            {time}
                        </span>
                        {w && (
                            <>
                                <span style={{ fontSize: 12 }}>{w.icon}</span>
                                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
                                    {w.temp}°
                                </span>
                            </>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
