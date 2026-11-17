// ===========================================================================
// Blue Ridge Parkway Road Status: site logic
// 1. Load data/parkway_status.json (written daily by the 06_publish notebook)
// 2. Fill in the header times and KPI cards from the summary
// 3. Draw every section on the map, colored by status
// 4. List the sections that aren't fully open; clicking one zooms the map
// ===========================================================================

const DATA_URL = "data/parkway_status.json";

// Status colors: same values as style.css and the gold review map
const STATUS_COLORS = {
  open:    "#2f6b4f",
  reduced: "#d68910",
  closed:  "#c0392b",
  unknown: "#7f8c8d",
};


// ---------- Small helpers ----------

// Put text into an element by its id
function setText(id, text) {
  document.getElementById(id).textContent = text;
}

// Make text safe to insert as HTML (so NPS text can't break the page)
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Turn the pipeline's UTC time text into a Date.
// Python writes e.g. "2026-11-17 14:02:11.123456" (UTC, no zone marker), which
// some browsers can't read, so convert it to standard ISO form: "2026-11-17T14:02:11.123Z"
function parseUtc(text) {
  if (!text) return null;
  let iso = String(text).trim().replace(" ", "T");
  iso = iso.replace(/(\.\d{3})\d+/, "$1");                  // keep milliseconds only
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += "Z";       // no zone given -> it's UTC
  const date = new Date(iso);
  return isNaN(date) ? null : date;
}

// "MP 63.5–63.9 (0.4 mi)"
function rangeLabel(p) {
  return `MP ${p.mp_start}–${p.mp_end} (${p.length_mi} mi)`;
}

// Link to this repo automatically when hosted at <user>.github.io/<repo>/
function setRepoLink() {
  const link = document.getElementById("repo-link");
  const { hostname, pathname } = window.location;
  if (hostname.endsWith("github.io")) {
    const user = hostname.split(".")[0];
    const repo = pathname.split("/").filter(Boolean)[0];
    link.href = `https://github.com/${user}/${repo}`;
  } else {
    link.style.display = "none";                            // e.g. when previewing locally
  }
}


// ---------- Map setup ----------

// Start centred on the parkway; zoom is adjusted once the sections load
const map = L.map("map").setView([36.6, -80.8], 7);

// Background map tiles from OpenStreetMap (free, with required credit)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Legend in the bottom-left corner
const legend = L.control({ position: "bottomleft" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML = Object.entries(STATUS_COLORS)
    .map(([status, color]) => `<div><i style="background:${color}"></i>${status}</div>`)
    .join("");
  return div;
};
legend.addTo(map);


// ---------- Fill in the page ----------

function showFreshness(data) {
  setText("nps-as-of", data.nps_as_of || "unknown");
  const fetched = parseUtc(data.fetched_at);
  setText("fetched-at", fetched ? fetched.toLocaleString() : "unknown");   // shown in the visitor's time zone
}

function showKpis(summary) {
  const all = summary.ALL;                                  // whole-parkway row
  setText("kpi-passable", `${all.pct_passable}%`);
  setText("kpi-open",     all.miles_open);
  setText("kpi-reduced",  all.miles_reduced);
  setText("kpi-closed",   all.miles_closed);
}

// Draw every section; returns the layers so the list can zoom to them
function drawSections(sections) {
  const drawn = [];

  const layer = L.geoJSON(sections, {
    // Line color and width by status
    style: (feature) => ({
      color: STATUS_COLORS[feature.properties.status] || STATUS_COLORS.unknown,
      weight: feature.properties.status === "open" ? 4 : 7,   // problems drawn thicker
      opacity: 0.9,
    }),

    // Popup with details when a section is clicked
    onEachFeature: (feature, sectionLayer) => {
      const p = feature.properties;
      sectionLayer.bindPopup(`
        <strong>${escapeHtml(p.state)} ${rangeLabel(p)}</strong><br>
        Status: <strong>${escapeHtml(p.status)}</strong> (${escapeHtml(p.status_raw)})<br>
        ${escapeHtml(p.crossroads)}
        ${p.notes ? `<br><em>${escapeHtml(p.notes)}</em>` : ""}
      `);
      drawn.push({ properties: p, layer: sectionLayer });
    },
  }).addTo(map);

  map.fitBounds(layer.getBounds(), { padding: [20, 20] });   // zoom to the whole parkway
  return drawn;
}

// List sections that aren't fully open, north to south
function showList(drawn) {
  const list = document.getElementById("section-list");
  const problems = drawn
    .filter((d) => d.properties.status !== "open")
    .sort((a, b) => a.properties.mp_start - b.properties.mp_start);

  if (problems.length === 0) {
    list.innerHTML = '<p class="muted">The whole parkway is open.</p>';
    return;
  }

  list.innerHTML = "";
  for (const { properties: p, layer } of problems) {
    const item = document.createElement("div");
    item.className = `item ${p.status}`;
    item.innerHTML = `
      <div class="item-range">${escapeHtml(p.state)} ${rangeLabel(p)}
        <span class="badge ${p.status}">${escapeHtml(p.status.toUpperCase())}</span></div>
      <div class="item-text">${escapeHtml(p.crossroads)}</div>
    `;
    // Click: zoom to the section and open its popup
    item.addEventListener("click", () => {
      map.fitBounds(layer.getBounds(), { maxZoom: 12 });
      layer.openPopup();
    });
    list.appendChild(item);
  }
}


// ---------- Start ----------

async function init() {
  setRepoLink();
  try {
    // cache: "no-store" -> always fetch the newest file, not a saved copy
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    showFreshness(data);
    showKpis(data.summary);
    showList(drawSections(data.sections));
  } catch (error) {
    console.error("Could not load parkway data:", error);
    setText("nps-as-of", "unavailable");
    setText("fetched-at", "unavailable");
    document.getElementById("section-list").innerHTML =
      '<p class="muted">Road status data could not be loaded. Please check the official NPS page.</p>';
  }
}

init();
