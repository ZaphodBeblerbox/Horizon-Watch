/**
 * confirm.js — "Are you sure?" inside the app, not the browser's.
 *
 * window.confirm() does nothing in the desktop app (Tauri's web view shows no
 * dialog without a plugin), so a delete behind it silently never happened —
 * the theater ✕ among them (owner, 2026-10-12). This draws its own small
 * dialog on the page, the same in the browser, the phone and the desktop app.
 *
 *   if (await confirmAction({ title, message, confirm: "Delete", danger: true })) …
 *
 * Plain DOM, no React: any component, or none, can call it.
 */
export function confirmAction({ title = "Are you sure?", message = "", confirm = "Confirm", cancel = "Cancel", danger = false } = {}) {
    if (typeof document === "undefined") return Promise.resolve(false)
    return new Promise((resolve) => {
        const back = document.createElement("div")
        back.setAttribute("data-testid", "confirm-dialog")
        back.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(4,8,14,.55);display:grid;place-items:center;padding:16px;"
            + "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif"
        const box = document.createElement("div")
        box.setAttribute("role", "alertdialog")
        box.setAttribute("aria-modal", "true")
        box.style.cssText = "width:min(380px,100%);background:var(--bg-2,#141a24);color:var(--txt,#e9ebef);border:1px solid var(--gline2,rgba(255,255,255,.14));"
            + "border-radius:12px;padding:18px 18px 14px;box-shadow:0 18px 50px rgba(0,0,0,.5)"
        const h = document.createElement("div")
        h.textContent = title
        h.style.cssText = "font-size:16px;font-weight:650;margin-bottom:6px"
        const p = document.createElement("div")
        p.textContent = message
        p.style.cssText = "font-size:14px;line-height:1.45;color:var(--txt2,#c3c7cf);margin-bottom:16px"
        const row = document.createElement("div")
        row.style.cssText = "display:flex;justify-content:flex-end;gap:8px"
        const btn = (label, primary) => {
            const b = document.createElement("button")
            b.type = "button"
            b.textContent = label
            b.style.cssText = "height:34px;padding:0 14px;border-radius:8px;font:inherit;font-size:14px;cursor:pointer;"
                + (primary
                    ? `border:0;color:#fff;background:${danger ? "#d23c3c" : "var(--acc,#3d7bf0)"};font-weight:600`
                    : "border:1px solid var(--gline2,rgba(255,255,255,.14));background:transparent;color:var(--txt,#e9ebef)")
            return b
        }
        const no = btn(cancel, false)
        const yes = btn(confirm, true)
        yes.setAttribute("data-testid", "confirm-yes")
        no.setAttribute("data-testid", "confirm-no")
        row.append(no, yes)
        box.append(h, p, row)
        back.append(box)
        const done = (v) => {
            document.removeEventListener("keydown", onKey, true)
            back.remove()
            resolve(v)
        }
        const onKey = (e) => {
            if (e.key === "Escape") { e.preventDefault(); done(false) }
            if (e.key === "Enter") { e.preventDefault(); done(true) }
        }
        no.onclick = () => done(false)
        yes.onclick = () => done(true)
        back.onclick = (e) => { if (e.target === back) done(false) }
        document.addEventListener("keydown", onKey, true)
        document.body.append(back)
        yes.focus()
    })
}
