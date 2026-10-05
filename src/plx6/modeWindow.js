/**
 * modeWindow.js — ONE BOX, FOR EVERY MODE.
 *
 * Part B gives Home an exact frame: left 58, right 12, top 84, bottom 12,
 * z 22, glass, square corners. That frame is not Home's — it is what a
 * mode looks like, and the spec repeats the same numbers for every screen
 * that fills the content area.
 *
 * It was drifting. Home and Insight carried `margin: 0 12px 12px 10px`,
 * which lands on the spec's numbers by arithmetic against the content
 * area's own 48/84 offset; Constellation used `position:absolute; inset:0`
 * and so ran to 48,84 at 1632×966 — ten pixels wider on the left and
 * twelve on the right than every other screen, which reads as that one
 * screen pressing against the window. Three expressions of one rule is
 * three chances to get it wrong, and it already had.
 *
 * So the rule is written once. A mode screen spreads `MODE_WINDOW` and
 * adds nothing positional.
 */

/**
 * THE FRAME, APPLIED ONCE, BY THE LAYER.
 *
 * It used to be spread by each screen that remembered to. Four did; the
 * other thirteen rendered bare onto the canvas, so moving between modes
 * flipped between "glass sheet on a map" and "content floating on the
 * background" — reported as changing too often between translucent and
 * not. app.jsx's `modeLayer()` now carries this, so a mode cannot opt out
 * of it by omission and a new screen gets it for free.
 */
export const MODE_FRAME = {
    // The layer is position:absolute inset:0 inside the content area; the
    // margin pulls it to the spec's left 58 / right 12 / bottom 12.
    margin: "0 12px 12px 10px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "var(--glass)",
    backdropFilter: "blur(22px) saturate(1.15)",
    WebkitBackdropFilter: "blur(22px) saturate(1.15)",
    border: "1px solid var(--gline)",
    boxShadow: "var(--gshadow)",
    borderRadius: 0,
    fontFamily: "var(--mz-font-body)",
}

/**
 * The padding a mode's scrolling body uses.
 *
 * NO MAX-WIDTH. Home capped its content at 1440px, so on a 1680 window
 * ~130px of the frame stayed empty while the frame itself looked right —
 * the window was the correct size and the content inside it was not
 * filling it. A measure cap is right for prose; these screens are grids of
 * cards that should use the room they are given.
 */
export const MODE_BODY = {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "20px 20px 28px",
}

/**
 * What a mode screen uses as ITS OWN root, inside the frame above.
 *
 * No background and no border: the frame owns both, and a screen that
 * paints its own would be a second pane of glass over the first. Screens
 * that need a grid (Inbox) override display/gridTemplateColumns and
 * nothing else.
 */
export const MODE_SURFACE = {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
}
