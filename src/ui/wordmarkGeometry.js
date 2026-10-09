/**
 * wordmarkGeometry.js — the PARALLAX letters, one drawing for every place
 * the word appears (ui/Wordmark.jsx, plx6/PlxWordmark.jsx, the opener).
 *
 * LEVEL. Every letter stands on one baseline (y 21.3) and reaches one cap
 * line (y 0). The earlier drawing set the two L's 2.6 units high and let
 * the X overshoot both lines, then clipped the box flat; wherever the clip
 * did not apply the word looked uneven, and the owner wants it level
 * everywhere (2026-10-10). Three copies of the paths had drifted apart, so
 * they live here once.
 *
 * Stroke 2.6, butt caps. The echoes are the X's rising stroke seen twice
 * more, parallel to it (slope 13.6 / 21.3), each shorter and further out.
 */
export const WORD_VIEWBOX = "0 0 145 21.3"

export const LETTER_PATHS = [
    "M1.3 21.3 V1.3 H8 C11.6 1.3 12.7 3.5 12.7 6.2 C12.7 8.9 11.6 11 8 11 H1.3",                     // P
    "M17.74 21.3 L23.3 1.3 H25.7 L31.26 21.3",                                                         // A
    "M37.3 21.3 V1.3 H44 C47.6 1.3 48.7 3.5 48.7 6.2 C48.7 8.9 47.6 11 44 11 H37.3 M43.5 11 L49.8 21.3", // R
    "M53.74 21.3 L59.3 1.3 H61.7 L67.26 21.3",                                                         // A
    "M73.3 0 V20 H83 M88.8 0 V20 H98.5",                                                               // L L
    "M103.24 21.3 L108.8 1.3 H111.2 L116.76 21.3",                                                     // A
]
export const X_PATHS = ["M121.2 0 L134.8 21.3", "M134.8 0 L121.2 21.3"]
export const ECHO_PATHS = ["M139 0 L131.15 12.3", "M143.2 0 L139.18 6.3"]
