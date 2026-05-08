// 3D city labels — dot + floating name label, distance-gated by altitude.
// Same city list as the 2D MapPage city labels layer.

import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import {
    Cartesian3, Color, LabelStyle, VerticalOrigin, HorizontalOrigin,
    DistanceDisplayCondition, NearFarScalar,
} from "cesium"

// ── City data (mirrors MAJOR_CITIES in mappage.jsx) ──────────────────────────
const CITIES = [
    // East Africa
    { name:"Nairobi",        lat:-1.286,  lon:36.817  }, { name:"Dar es Salaam", lat:-6.800,  lon:39.283  },
    { name:"Addis Ababa",    lat:9.025,   lon:38.747  }, { name:"Kampala",       lat:0.347,   lon:32.583  },
    { name:"Kigali",         lat:-1.944,  lon:30.059  }, { name:"Mogadishu",     lat:2.046,   lon:45.341  },
    { name:"Djibouti",       lat:11.589,  lon:43.145  }, { name:"Asmara",        lat:15.339,  lon:38.931  },
    // Southern Africa
    { name:"Johannesburg",   lat:-26.195, lon:28.034  }, { name:"Cape Town",     lat:-33.924, lon:18.424  },
    { name:"Lusaka",         lat:-15.417, lon:28.283  }, { name:"Harare",        lat:-17.829, lon:31.052  },
    { name:"Maputo",         lat:-25.965, lon:32.573  }, { name:"Antananarivo",  lat:-18.913, lon:47.536  },
    // West/Central Africa
    { name:"Lagos",          lat:6.524,   lon:3.379   }, { name:"Kinshasa",      lat:-4.322,  lon:15.322  },
    { name:"Accra",          lat:5.600,   lon:-0.187  }, { name:"Dakar",         lat:14.693,  lon:-17.447 },
    { name:"Abidjan",        lat:5.354,   lon:-4.008  }, { name:"Khartoum",      lat:15.500,  lon:32.560  },
    // North Africa / Middle East
    { name:"Cairo",          lat:30.044,  lon:31.236  }, { name:"Tripoli",       lat:32.902,  lon:13.180  },
    { name:"Tunis",          lat:36.819,  lon:10.166  }, { name:"Algiers",       lat:36.752,  lon:3.042   },
    { name:"Riyadh",         lat:24.689,  lon:46.688  }, { name:"Baghdad",       lat:33.341,  lon:44.401  },
    { name:"Tehran",         lat:35.696,  lon:51.423  }, { name:"Ankara",        lat:39.933,  lon:32.860  },
    { name:"Amman",          lat:31.956,  lon:35.945  }, { name:"Beirut",        lat:33.888,  lon:35.495  },
    { name:"Aden",           lat:12.780,  lon:45.036  }, { name:"Sana'a",        lat:15.355,  lon:44.207  },
    // Europe
    { name:"London",         lat:51.507,  lon:-0.128  }, { name:"Paris",         lat:48.857,  lon:2.347   },
    { name:"Berlin",         lat:52.520,  lon:13.405  }, { name:"Rome",          lat:41.902,  lon:12.496  },
    { name:"Madrid",         lat:40.417,  lon:-3.702  }, { name:"Athens",        lat:37.983,  lon:23.728  },
    { name:"Warsaw",         lat:52.229,  lon:21.012  }, { name:"Kyiv",          lat:50.450,  lon:30.524  },
    { name:"Moscow",         lat:55.751,  lon:37.617  }, { name:"Istanbul",      lat:41.015,  lon:28.979  },
    // South / Southeast Asia
    { name:"Mumbai",         lat:19.076,  lon:72.878  }, { name:"Delhi",         lat:28.614,  lon:77.209  },
    { name:"Karachi",        lat:24.861,  lon:67.010  }, { name:"Kabul",         lat:34.528,  lon:69.172  },
    { name:"Bangkok",        lat:13.756,  lon:100.502 }, { name:"Singapore",     lat:1.353,   lon:103.822 },
    { name:"Jakarta",        lat:-6.211,  lon:106.845 }, { name:"Yangon",        lat:16.867,  lon:96.195  },
    // Global capitals / large cities
    { name:"Washington D.C.",lat:38.907,  lon:-77.037 }, { name:"New York",      lat:40.713,  lon:-74.006 },
    { name:"Los Angeles",    lat:34.052,  lon:-118.244}, { name:"São Paulo",     lat:-23.550, lon:-46.633 },
    { name:"Buenos Aires",   lat:-34.603, lon:-58.381 }, { name:"Mexico City",   lat:19.433,  lon:-99.133 },
    { name:"Beijing",        lat:39.905,  lon:116.391 }, { name:"Shanghai",      lat:31.228,  lon:121.474 },
    { name:"Tokyo",          lat:35.690,  lon:139.692 }, { name:"Seoul",         lat:37.566,  lon:126.978 },
    { name:"Sydney",         lat:-33.868, lon:151.209 }, { name:"Islamabad",     lat:33.729,  lon:73.094  },
    { name:"Kathmandu",      lat:27.700,  lon:85.318  }, { name:"Colombo",       lat:6.927,   lon:79.862  },
    { name:"Doha",           lat:25.286,  lon:51.534  }, { name:"Abu Dhabi",     lat:24.453,  lon:54.377  },
    { name:"Kuwait City",    lat:29.369,  lon:47.978  }, { name:"Manama",        lat:26.225,  lon:50.586  },
    { name:"Muscat",         lat:23.614,  lon:58.593  }, { name:"Ashgabat",      lat:37.950,  lon:58.383  },
    { name:"Tashkent",       lat:41.299,  lon:69.240  }, { name:"Almaty",        lat:43.222,  lon:76.851  },
]

const LABEL_COLOR = Color.fromCssColorString("rgba(230,240,255,0.92)")
const DOT_COLOR   = Color.fromCssColorString("rgba(255,255,255,0.80)")
const BG_COLOR    = Color.fromCssColorString("rgba(6,12,28,0.72)")

// Labels fade in as you zoom in — visible from ~5,000km altitude down to surface
const SHOW_RANGE   = new DistanceDisplayCondition(0, 5_000_000)
// Dots visible slightly further out
const DOT_RANGE    = new DistanceDisplayCondition(0, 6_000_000)
// Scale labels: full size at 500km, half size at 4,000km
const SCALE_NF     = new NearFarScalar(500_000, 1.0, 4_000_000, 0.55)

export default function GlobeCityLabelsLayer({ enabled }) {
    const { viewer } = useCesium()
    const entitiesRef = useRef([])

    useEffect(() => {
        if (!viewer) return

        const cleanup = () => {
            entitiesRef.current.forEach(e => {
                if (viewer.entities.contains(e)) viewer.entities.remove(e)
            })
            entitiesRef.current = []
        }

        cleanup()
        if (!enabled) return

        const added = []

        CITIES.forEach(city => {
            const pos = Cartesian3.fromDegrees(city.lon, city.lat, 0)
            const e = viewer.entities.add({
                position: pos,
                point: {
                    pixelSize:                4,
                    color:                    DOT_COLOR,
                    outlineColor:             Color.fromCssColorString("rgba(0,0,0,0.5)"),
                    outlineWidth:             1,
                    distanceDisplayCondition: DOT_RANGE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    scaleByDistance:          new NearFarScalar(200_000, 1.4, 4_000_000, 0.7),
                },
                label: {
                    text:           city.name,
                    font:           "600 11px system-ui, -apple-system, Arial, sans-serif",
                    fillColor:      LABEL_COLOR,
                    outlineColor:   Color.fromCssColorString("rgba(0,0,0,0.9)"),
                    outlineWidth:   2,
                    style:          LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: VerticalOrigin.BOTTOM,
                    horizontalOrigin: HorizontalOrigin.CENTER,
                    pixelOffset:    { x: 0, y: -8 },
                    showBackground: true,
                    backgroundColor: BG_COLOR,
                    backgroundPadding: { x: 5, y: 3 },
                    scaleByDistance:   SCALE_NF,
                    distanceDisplayCondition: SHOW_RANGE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })
            added.push(e)
        })

        entitiesRef.current = added
        return cleanup
    }, [viewer, enabled])

    return null
}
