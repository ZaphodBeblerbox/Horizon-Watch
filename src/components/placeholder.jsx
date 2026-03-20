export default function Placeholder({ page }) {
    return (
        <div style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 12,
            color: "#bbb"
        }}>
            <div style={{ fontSize: 28, letterSpacing: "0.1em" }}>◎</div>
            <div style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {page} — coming soon
            </div>
        </div>
    )
}