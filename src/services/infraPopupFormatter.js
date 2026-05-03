const ICONS  = { power: "⚡", telecoms: "📡", petroleum: "🛢", water: "💧" }
const COLORS = { power: "#E8B23A", telecoms: "#6C9CE0", petroleum: "#E55757", water: "#4A9EE0" }

// Layer names verified against live OpenInfraMap PBF tiles
const FEATURE_NAMES = {
    power_line:             "Power Line",
    power_substation:       "Substation",
    power_substation_point: "Substation",
    power_generator:        "Generator",
    power_generator_area:   "Generator",
    power_plant:            "Power Plant",
    power_plant_point:      "Power Plant",
    petroleum_pipeline:     "Pipeline",
    petroleum_well:         "Well",
    petroleum_site:         "Facility",
    telecoms_mast:          "Telecoms Mast",
    telecoms_data_center:   "Data Centre",
    water_pipeline:         "Water Main",
}

// Voltage is stored in kV in OpenInfraMap tiles (e.g. 275 = 275 kV)
function formatVoltage(v) {
    const n = parseInt(v, 10)
    if (isNaN(n)) return String(v)
    return `${n} kV`
}

function buildRows(group, props) {
    const f = []
    if (group === "power") {
        if (props.voltage)   f.push(["Voltage",   formatVoltage(props.voltage)])
        if (props.circuits)  f.push(["Circuits",  props.circuits])
        if (props.operator)  f.push(["Operator",  props.operator])
        if (props.name)      f.push(["Name",      props.name])
        if (props.location)  f.push(["Location",  props.location])
        if (props.frequency) f.push(["Frequency", `${props.frequency} Hz`])
        if (props.source)    f.push(["Source",    props.source])
        if (props.output)    f.push(["Output",    props.output])
        if (props.ref)       f.push(["Ref",       props.ref])
    } else if (group === "telecoms") {
        if (props.operator)  f.push(["Operator",  props.operator])
        if (props.name)      f.push(["Name",      props.name])
        if (props.type)      f.push(["Type",      props.type])
        if (props.ref)       f.push(["Ref",       props.ref])
    } else if (group === "petroleum") {
        if (props.substance) f.push(["Substance", props.substance])
        if (props.operator)  f.push(["Operator",  props.operator])
        if (props.location)  f.push(["Location",  props.location])
        if (props.name)      f.push(["Name",      props.name])
        if (props.ref)       f.push(["Ref",       props.ref])
    } else if (group === "water") {
        if (props.operator)  f.push(["Operator",  props.operator])
        if (props.substance) f.push(["Substance", props.substance])
        if (props.location)  f.push(["Location",  props.location])
        if (props.name)      f.push(["Name",      props.name])
        if (props.ref)       f.push(["Ref",       props.ref])
    }
    return f
}

export function formatInfraPopup(group, props) {
    // VectorGrid exposes the tile layer name via properties["@type"] or sourceTarget.options.layerName
    // Fall back to the group name for the feature label
    const layerName   = props["@type"] || `${group}_${props.type || ""}`.trim()
    const featureName = FEATURE_NAMES[layerName] || FEATURE_NAMES[`${group}_${props.type}`] || group.charAt(0).toUpperCase() + group.slice(1)
    const icon  = ICONS[group]  || "●"
    const color = COLORS[group] || "#888"
    const fields = buildRows(group, props)

    const osmId  = props.osm_id
    const osmUrl = osmId ? `https://www.openstreetmap.org/way/${osmId}` : null

    const rows = fields.length
        ? fields.map(([label, value]) =>
            `<tr>
              <td style="color:rgba(232,237,242,0.5);padding:2px 10px 2px 0;font-size:11px;white-space:nowrap">${label}</td>
              <td style="color:#e8edf2;padding:2px 0;font-size:11px">${value}</td>
            </tr>`).join("")
        : `<tr><td colspan="2" style="color:rgba(232,237,242,0.35);font-size:11px;font-style:italic">No attributes</td></tr>`

    return `<div style="background:#1A2433;border-radius:6px;padding:10px 12px;min-width:180px;max-width:260px;font-family:Inter,-apple-system,sans-serif">
      <div style="font-size:13px;font-weight:700;color:${color};margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <span>${icon}</span><span>${featureName}</span>
      </div>
      <table style="border-collapse:collapse;width:100%">${rows}</table>
      ${osmUrl ? `<div style="margin-top:8px"><a href="${osmUrl}" target="_blank" rel="noopener noreferrer" style="font-size:10px;color:rgba(232,237,242,0.4);text-decoration:none">↗ View on OpenStreetMap</a></div>` : ""}
    </div>`
}
