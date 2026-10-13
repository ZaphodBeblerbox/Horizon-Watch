// The Strikes & control layer's chosen acts and time window (strikes.js), as a hook.
import { useEffect, useState } from "react"
import { coveredIds, strikeSettings, subscribeCovered, subscribeStrikeSettings } from "./strikes.js"

export function useStrikeSettings() {
    const [s, setS] = useState(strikeSettings)
    useEffect(() => subscribeStrikeSettings(setS), [])
    return s
}

/** The Telegram / GeoConfirmed ids strike pins currently stand for. */
export function useCoveredIds() {
    const [s, setS] = useState(coveredIds)
    useEffect(() => subscribeCovered(setS), [])
    return s
}
