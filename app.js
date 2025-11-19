import { parseFitData } from "./parse.js";

// --- State ---
const APP = {
    data: null, // Holds the result from parse.js
    charts: [], // uPlot instances
    map: null,
    layers: {
        base: null, // Blue line (Full trace)
        highlight: null, // Red line (Selection)
        marker: null, // Moving dot
    },
};

// --- Init ---
function init() {
    // Setup Map
    APP.map = L.map("map", { zoomControl: false }).setView([0, 0], 2);
    L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        {
            attribution: "&copy; OpenStreetMap",
        }
    ).addTo(APP.map);
    L.control.zoom({ position: "bottomright" }).addTo(APP.map);

    // Event Listeners
    document
        .getElementById("fileInput")
        .addEventListener("change", handleUpload);

    // Handle resize
    window.addEventListener("resize", () => {
        APP.charts.forEach((u) => {
            if (u.root && u.root.parentElement) {
                u.setSize({
                    width: u.root.parentElement.clientWidth,
                    height: 160,
                });
            }
        });
        if (APP.map) APP.map.invalidateSize();
    });

    // Bootstrap Tab fix for Map
    document.querySelectorAll('button[data-bs-toggle="pill"]').forEach((el) => {
        el.addEventListener("shown.bs.tab", () => {
            APP.map.invalidateSize();
            if (APP.data && APP.data.bounds) APP.map.fitBounds(APP.data.bounds);
        });
    });

    // Listen for Explorer Tab changes to render Explorer view
    document
        .getElementById("explorer-tab")
        .addEventListener("shown.bs.tab", () => {
            if (APP.data) renderExplorer();
        });
}

// --- Upload & Process ---
async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById("loader").style.display = "flex";

    try {
        // 1. Parse Data
        APP.data = await parseFitData(file);

        // 2. Reset UI
        resetUI();

        // 3. Render Components
        renderMap();
        renderCharts();
        renderLaps();
        renderTable(APP.data.records); // Full record table

        // Show file name in dropdown (visual only for now)
        const select = document.getElementById("fileSelect");
        select.innerHTML = "";
        const opt = document.createElement("option");
        opt.text = file.name;
        select.appendChild(opt);
        document
            .getElementById("fileSelectorWrapper")
            .classList.remove("d-none");
        document.getElementById("fileSelectorWrapper").classList.add("d-flex");
    } catch (err) {
        console.error(err);
        alert("Error parsing file: " + err.message);
    } finally {
        document.getElementById("loader").style.display = "none";
    }
}

// --- Map Logic ---
function renderMap() {
    const { gps, bounds } = APP.data;
    const container = document.getElementById("mapContainer");

    if (!gps || !gps.length) {
        container.classList.add("d-none");
        return;
    }
    container.classList.remove("d-none");

    // Cleanup old layers
    if (APP.layers.base) APP.map.removeLayer(APP.layers.base);
    if (APP.layers.highlight) APP.map.removeLayer(APP.layers.highlight);
    if (APP.layers.marker) APP.map.removeLayer(APP.layers.marker);

    // 1. Base Layer (Blue - Always Full Trace)
    APP.layers.base = L.polyline(
        gps.map((p) => [p.lat, p.lon]),
        {
            color: "#2563eb",
            weight: 3,
            opacity: 0.6,
        }
    ).addTo(APP.map);

    // 2. Highlight Layer (Red - Initially Empty)
    APP.layers.highlight = L.polyline([], {
        color: "#dc2626",
        weight: 4,
        opacity: 1,
    }).addTo(APP.map);

    // 3. Marker
    APP.layers.marker = L.circleMarker([0, 0], {
        radius: 6,
        color: "#2563eb",
        fillColor: "#fff",
        fillOpacity: 1,
        opacity: 0,
    }).addTo(APP.map);

    // 4. Fit Bounds
    setTimeout(() => {
        APP.map.invalidateSize();
        APP.map.fitBounds(bounds, { padding: [30, 30] });
    }, 100);
}

function updateMapSelection(minTs, maxTs) {
    if (!APP.data.gps.length) return;

    // Filter GPS points based on timestamp range
    const segment = APP.data.gps.filter((p) => p.ts >= minTs && p.ts <= maxTs);

    if (segment.length > 0) {
        const latlngs = segment.map((p) => [p.lat, p.lon]);
        APP.layers.highlight.setLatLngs(latlngs);
        APP.map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });
    }
}

function resetMapState() {
    if (!APP.data || !APP.data.bounds) return;
    APP.layers.highlight.setLatLngs([]); // Clear red line
    APP.map.fitBounds(APP.data.bounds, { padding: [30, 30] }); // Zoom to full
}

function syncMarker(idx) {
    if (!APP.data.gps.length) return;
    // Find GPS point matching record index
    const p = APP.data.gps.find((p) => p.i === idx);
    if (p) {
        APP.layers.marker.setLatLng([p.lat, p.lon]).setStyle({ opacity: 1 });
    }
}

// --- Dynamic Charts ---
function renderCharts() {
    const { records, fields } = APP.data;
    const container = document.getElementById("charts-container");
    container.innerHTML = "";
    document.getElementById("charts-placeholder").classList.add("d-none");

    if (fields.length === 0) {
        container.innerHTML = `<div class="text-center text-muted mt-5">No chartable data found.</div>`;
        return;
    }

    // X-Axis: Time in seconds
    const xData = records.map((r) =>
        r.timestamp instanceof Date
            ? r.timestamp.getTime() / 1000
            : new Date(r.timestamp).getTime() / 1000
    );
    const sync = uPlot.sync("fitSync");

    // Generate a chart for every detected field
    fields.forEach((field, i) => {
        const div = document.createElement("div");
        div.className = "chart-wrapper";
        container.appendChild(div);

        const yData = records.map((r) => r[field] ?? null);
        const color = getColor(i);

        const u = new uPlot(
            {
                width: div.clientWidth,
                height: 160,
                cursor: {
                    sync: { key: sync.key, setSeries: true },
                    drag: { x: true, y: true, uni: 50 },
                },
                scales: { x: { time: true } },
                axes: [
                    {}, // X axis (Time)
                    {
                        // Y axis (Value)
                        label: formatLabel(field),
                        stroke: color,
                        size: 50,
                        labelSize: 20,
                        font: "12px Inter",
                    },
                ],
                series: [
                    {}, // X Series
                    {
                        stroke: color,
                        width: 2,
                        fill: color + "15",
                        label: formatLabel(field),
                    },
                ],
                hooks: {
                    setCursor: [
                        (u) => {
                            if (u.cursor.idx) syncMarker(u.cursor.idx);
                        },
                    ],
                    setSelect: [(u) => handleSelection(u)],
                },
            },
            [xData, yData],
            div
        );

        APP.charts.push(u);
    });
}

function handleSelection(u) {
    // Double Click / Reset (Zoom Out)
    if (u.select.width === 0) {
        document.getElementById("selectionStats").classList.add("d-none");
        document
            .getElementById("selectionTableContainer")
            .classList.add("d-none");
        resetMapState(); // Zoom map to full
        return;
    }

    // Get Range
    const min = u.posToVal(u.select.left, "x");
    const max = u.posToVal(u.select.left + u.select.width, "x");

    // Filter Data
    const subset = APP.data.records.filter((r) => {
        const t =
            r.timestamp instanceof Date
                ? r.timestamp.getTime() / 1000
                : new Date(r.timestamp).getTime() / 1000;
        return t >= min && t <= max;
    });

    if (subset.length) {
        renderAvgTable(subset);
        renderTable(subset, true); // Render subset into selection table
        updateMapSelection(min, max); // Zoom map to selection
    }
}

// --- Tables ---

function renderTable(data, isSelection = false) {
    const tableId = isSelection ? "#selectionTable" : "#datatable";
    const container = document.getElementById("selectionTableContainer");

    if (isSelection) {
        container.classList.remove("d-none");
        document.getElementById(
            "selectionCountBadge"
        ).textContent = `${data.length} records`;
    }

    if ($.fn.DataTable.isDataTable(tableId)) {
        $(tableId).DataTable().destroy();
        document.querySelector(tableId).innerHTML = "";
    }

    if (data.length === 0) return;

    // Define Columns
    // We always want Time and Distance first, then the dynamic fields
    const dynamicKeys = APP.data.fields;

    const columns = [
        {
            title: "Time",
            data: "timestamp",
            render: (d) => {
                if (!d) return "-";
                if (d instanceof Date) return d.toLocaleTimeString();
                if (typeof d === "string" && d.includes("T"))
                    return d.split("T")[1].replace("Z", "");
                return String(d);
            },
        },
        {
            title: "Dist (km)",
            data: "distance",
            render: (d) => (typeof d === "number" ? d.toFixed(3) : "-"),
        },
        ...dynamicKeys.map((k) => ({
            title: formatLabel(k),
            data: k,
            defaultContent: "-",
            render: (d) =>
                typeof d === "number" ? parseFloat(d.toFixed(1)) : d,
        })),
    ];

    $(tableId).DataTable({
        data: data,
        columns: columns,
        pageLength: isSelection ? 5 : 15,
        lengthMenu: [5, 15, 50, 100],
        searching: !isSelection, // Only search on explorer
        ordering: false, // Performance optimization
        scrollX: true,
        dom: isSelection
            ? "<'row'<'col-12'tr>>" + "<'row mt-2 small'<'col-6'i><'col-6'p>>" // Compact
            : "<'row mb-2'<'col-6'l><'col-6'f>>" +
              "<'row'<'col-12'tr>>" +
              "<'row mt-2'<'col-6'i><'col-6'p>>", // Full
    });
}

function renderAvgTable(subset) {
    document.getElementById("selectionStats").classList.remove("d-none");
    const table = document.getElementById("avgTable");
    table.innerHTML = "";

    const metrics = APP.data.fields; // Use detected fields

    // Header
    let html = "<thead><tr>";
    html += "<th>Time</th><th>Dist</th>";
    metrics.forEach((k) => (html += `<th>Avg ${formatLabel(k)}</th>`));
    html += "</tr></thead><tbody><tr>";

    // Data
    const first = subset[0];
    const last = subset[subset.length - 1];

    const t1 =
        first.timestamp instanceof Date
            ? first.timestamp.getTime()
            : new Date(first.timestamp).getTime();
    const t2 =
        last.timestamp instanceof Date
            ? last.timestamp.getTime()
            : new Date(last.timestamp).getTime();

    const time = (t2 - t1) / 1000;
    const dist = (last.distance || 0) - (first.distance || 0);

    html += `<td>${formatDuration(time)}</td><td>${dist.toFixed(2)}</td>`;

    metrics.forEach((k) => {
        const valid = subset.filter((r) => typeof r[k] === "number");
        const avg = valid.length
            ? valid.reduce((a, b) => a + b[k], 0) / valid.length
            : 0;
        html += `<td>${avg.toFixed(1)}</td>`;
    });

    html += "</tr></tbody>";
    table.innerHTML = html;
}

function renderLaps() {
    const laps = APP.data.laps;
    const container = document.getElementById("lapsContainer");

    if (!laps || !laps.length) {
        container.classList.add("d-none");
        return;
    }
    container.classList.remove("d-none");

    const table = $("#lapSummaryTable");
    if ($.fn.DataTable.isDataTable("#lapSummaryTable")) {
        table.DataTable().destroy();
    }
    document.getElementById("lapSummaryTable").innerHTML = "";

    const columns = [
        {
            title: "#",
            data: null,
            width: "5%",
            render: (d, t, r, m) => m.row + 1,
        },
        {
            title: "Time",
            data: "total_elapsed_time",
            render: (d) => formatDuration(d),
        },
        {
            title: "Dist",
            data: "total_distance",
            render: (d) => (d || 0).toFixed(2),
        },
        {
            title: "Avg Speed",
            data: "avg_speed",
            render: (d) => (d || 0).toFixed(1),
        },
        {
            title: "Avg HR",
            data: "avg_heart_rate",
            render: (d) => (d ? Math.round(d) : "-"),
        },
        {
            title: "Avg Pwr",
            data: "avg_power",
            render: (d) => (d ? Math.round(d) : "-"),
        },
        {
            title: "Avg Cad",
            data: "avg_cadence",
            render: (d) => (d ? Math.round(d) : "-"),
        },
    ];

    $("#lapSummaryTable").DataTable({
        data: laps,
        columns: columns,
        paging: false,
        searching: false,
        info: false,
        ordering: false,
        scrollY: "250px",
        scrollCollapse: true,
    });
}

function renderExplorer() {
    // We simply reuse the main renderTable for the 'Explorer' tab records view
    // The tab listener at init triggers this
    const viewType = document.querySelector(
        'input[name="dataView"]:checked'
    ).value;

    if (viewType === "records") {
        document
            .getElementById("explorer-table-container")
            .classList.remove("d-none");
        document
            .getElementById("explorer-json-container")
            .classList.add("d-none");
        renderTable(APP.data.records, false);
    } else if (viewType === "raw") {
        document
            .getElementById("explorer-table-container")
            .classList.add("d-none");
        document
            .getElementById("explorer-json-container")
            .classList.remove("d-none");
        document.getElementById("json-code").textContent = JSON.stringify(
            APP.data.raw,
            null,
            2
        );
        hljs.highlightElement(document.getElementById("json-code"));
    } else {
        // Laps or Sessions
        document
            .getElementById("explorer-table-container")
            .classList.remove("d-none");
        document
            .getElementById("explorer-json-container")
            .classList.add("d-none");
        // Basic dump of other arrays for now
        const data = APP.data[viewType] || [];
        if (data.length) {
            // Simple dynamic table for non-records
            if ($.fn.DataTable.isDataTable("#datatable"))
                $("#datatable").DataTable().destroy();
            const keys = Object.keys(data[0]).slice(0, 10);
            const cols = keys.map((k) => ({
                title: k,
                data: k,
                defaultContent: "-",
            }));
            $("#datatable").DataTable({
                data: data,
                columns: cols,
                scrollX: true,
            });
        }
    }
}

// --- Utils ---
function resetUI() {
    APP.charts.forEach((u) => u.destroy());
    APP.charts = [];
    document.getElementById("charts-container").innerHTML = "";
    document.getElementById("selectionTableContainer").classList.add("d-none");
    document.getElementById("selectionStats").classList.add("d-none");
    if ($.fn.DataTable.isDataTable("#datatable"))
        $("#datatable").DataTable().destroy();
    if ($.fn.DataTable.isDataTable("#selectionTable"))
        $("#selectionTable").DataTable().destroy();
    document.getElementById("datatable").innerHTML = "";
}

function formatLabel(str) {
    return str
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase())
        .replace("Heart Rate", "HR")
        .replace("Cadence", "Cad")
        .replace("Altitude", "Alt");
}

function formatDuration(s) {
    if (!s) return "-";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
}

function getColor(i) {
    const colors = [
        "#3b82f6",
        "#ef4444",
        "#f59e0b",
        "#10b981",
        "#8b5cf6",
        "#ec4899",
        "#6366f1",
    ];
    return colors[i % colors.length];
}

// Run
init();
