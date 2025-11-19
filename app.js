import { parseFitData } from "./parse.js";
import { ChartManager } from "./charts.js";

// --- State ---
const APP = {
    data: null,
    charts: new ChartManager("charts-container", "charts-placeholder"),
    map: null,
    layers: { base: null, highlight: null, marker: null },
};

// --- Init ---
function init() {
    // Map Setup
    APP.map = L.map("map", { zoomControl: false }).setView([0, 0], 2);
    L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        {
            attribution: "&copy; OpenStreetMap",
        }
    ).addTo(APP.map);
    L.control.zoom({ position: "bottomright" }).addTo(APP.map);

    // Listeners
    document
        .getElementById("fileInput")
        .addEventListener("change", handleUpload);
    window.addEventListener("resize", () => {
        APP.charts.resize();
        APP.map.invalidateSize();
    });

    // Tab Refresh fixes
    document.querySelectorAll('button[data-bs-toggle="pill"]').forEach((el) => {
        el.addEventListener("shown.bs.tab", () => {
            APP.map.invalidateSize();
            if (APP.data && APP.data.bounds) APP.map.fitBounds(APP.data.bounds);
        });
    });

    document
        .getElementById("explorer-tab")
        .addEventListener("shown.bs.tab", () => {
            if (APP.data) renderExplorer();
        });
}

// --- Controller ---
async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById("loader").style.display = "flex";

    try {
        APP.data = await parseFitData(file);

        // Update File UI
        document
            .getElementById("fileSelectorWrapper")
            .classList.replace("d-none", "d-flex");
        const s = document.getElementById("fileSelect");
        s.innerHTML = "";
        s.add(new Option(file.name));

        resetState();
        renderMap();
        renderTables();

        // Render Charts with Callbacks
        APP.charts.render(
            APP.data,
            (min, max) => handleChartSelection(min, max), // On Select
            (idx) => syncMarker(idx) // On Hover
        );
    } catch (err) {
        console.error(err);
        alert("Error: " + err.message);
    } finally {
        document.getElementById("loader").style.display = "none";
    }
}

function handleChartSelection(min, max) {
    // Reset State (Double Click clears selection)
    if (min === null || max === null) {
        document.getElementById("selectionStats").classList.add("d-none");
        document
            .getElementById("selectionTableContainer")
            .classList.add("d-none");

        // Clear Map Highlight & Zoom to Full Bounds
        if (APP.layers.highlight) APP.layers.highlight.setLatLngs([]);
        if (APP.data.bounds)
            APP.map.fitBounds(APP.data.bounds, { padding: [30, 30] });
        return;
    }

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
        renderRecordTable(subset, true);
        updateMapSelection(min, max);
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

    // Reset Layers
    if (APP.layers.base) APP.map.removeLayer(APP.layers.base);
    if (APP.layers.highlight) APP.map.removeLayer(APP.layers.highlight);
    if (APP.layers.marker) APP.map.removeLayer(APP.layers.marker);

    // Full Trace (Blue)
    APP.layers.base = L.polyline(
        gps.map((p) => [p.lat, p.lon]),
        { color: "#2563eb", weight: 3, opacity: 0.6 }
    ).addTo(APP.map);

    // Selection Trace (Red)
    APP.layers.highlight = L.polyline([], {
        color: "#dc2626",
        weight: 4,
        opacity: 1,
    }).addTo(APP.map);

    // Marker
    APP.layers.marker = L.circleMarker([0, 0], {
        radius: 6,
        color: "#2563eb",
        fillColor: "#fff",
        fillOpacity: 1,
        opacity: 0,
    }).addTo(APP.map);

    setTimeout(() => {
        APP.map.invalidateSize();
        APP.map.fitBounds(bounds, { padding: [30, 30] });
    }, 100);
}

function updateMapSelection(minTs, maxTs) {
    const segment = APP.data.gps.filter((p) => p.ts >= minTs && p.ts <= maxTs);
    if (segment.length > 0) {
        const latlngs = segment.map((p) => [p.lat, p.lon]);
        APP.layers.highlight.setLatLngs(latlngs);
        APP.map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });
    }
}

function syncMarker(idx) {
    const p = APP.data.gps.find((p) => p.i === idx);
    if (p) APP.layers.marker.setLatLng([p.lat, p.lon]).setStyle({ opacity: 1 });
}

// --- Table Logic ---
function renderTables() {
    renderLaps(APP.data.laps);
    renderRecordTable(APP.data.records, false);
}

function renderRecordTable(data, isSelection) {
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

    if (!data.length) return;

    const dynamicCols = APP.data.fields.map((k) => ({
        title: formatLabel(k),
        data: k,
        defaultContent: "-",
        render: (d) => (typeof d === "number" ? parseFloat(d.toFixed(1)) : d),
    }));

    const columns = [
        {
            title: "Time",
            data: "timestamp",
            render: (d) => {
                if (d instanceof Date) return d.toLocaleTimeString();
                return typeof d === "string" && d.includes("T")
                    ? d.split("T")[1].replace("Z", "")
                    : d;
            },
        },
        {
            title: "Dist",
            data: "distance",
            render: (d) => (d ? d.toFixed(3) : "-"),
        },
        ...dynamicCols,
    ];

    $(tableId).DataTable({
        data: data,
        columns: columns,
        pageLength: isSelection ? 5 : 15,
        lengthMenu: [5, 15, 50],
        searching: !isSelection,
        ordering: false,
        scrollX: true,
        dom: isSelection
            ? "<'row'<'col-12'tr>>p"
            : "<'row mb-2'<'col-6'l><'col-6'f>>rtip",
    });
}

// UPDATED: Uses DataTables to allow scrolling
function renderAvgTable(subset) {
    const container = document.getElementById("selectionStats");
    container.classList.remove("d-none");

    const tableId = "#avgTable";
    if ($.fn.DataTable.isDataTable(tableId)) {
        $(tableId).DataTable().destroy();
        document.querySelector(tableId).innerHTML = "";
    }

    // 1. Calculate Averages
    const first = subset[0];
    const last = subset[subset.length - 1];

    const t1 =
        first.timestamp instanceof Date
            ? first.timestamp
            : new Date(first.timestamp);
    const t2 =
        last.timestamp instanceof Date
            ? last.timestamp
            : new Date(last.timestamp);
    const duration = (t2 - t1) / 1000;
    const dist = (last.distance || 0) - (first.distance || 0);

    const rowData = {
        time: duration,
        dist: dist,
    };

    // Calculate dynamic averages
    APP.data.fields.forEach((k) => {
        const valid = subset.filter((r) => typeof r[k] === "number");
        const avg = valid.length
            ? valid.reduce((a, b) => a + b[k], 0) / valid.length
            : 0;
        rowData[k] = avg;
    });

    // 2. Define Columns
    const columns = [
        { title: "Duration", data: "time", render: (d) => formatDuration(d) },
        { title: "Distance", data: "dist", render: (d) => d.toFixed(2) },
    ];

    APP.data.fields.forEach((k) => {
        columns.push({
            title: "Avg " + formatLabel(k),
            data: k,
            render: (d) => d.toFixed(1),
        });
    });

    // 3. Render DataTable
    $(tableId).DataTable({
        data: [rowData], // Single row array
        columns: columns,
        dom: "t", // Only show table (no search, no pagination)
        scrollX: true, // Enable horizontal scrolling
        ordering: false,
        paging: false,
        info: false,
    });
}

function renderLaps(laps) {
    const container = document.getElementById("lapsContainer");
    if (!laps || !laps.length) {
        container.classList.add("d-none");
        return;
    }
    container.classList.remove("d-none");

    if ($.fn.DataTable.isDataTable("#lapSummaryTable"))
        $("#lapSummaryTable").DataTable().destroy();

    const cols = [
        { title: "#", data: null, render: (d, t, r, m) => m.row + 1 },
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
            title: "Avg HR",
            data: "avg_heart_rate",
            render: (d) => (d ? Math.round(d) : "-"),
        },
        {
            title: "Avg Pwr",
            data: "avg_power",
            render: (d) => (d ? Math.round(d) : "-"),
        },
    ];

    $("#lapSummaryTable").DataTable({
        data: laps,
        columns: cols,
        paging: false,
        searching: false,
        scrollX: true, // Added scrollX here too just in case
        scrollY: "200px",
    });
}

function renderExplorer() {
    // Explorer logic if needed
}

function resetState() {
    APP.charts.clear();
    document.getElementById("selectionTableContainer").classList.add("d-none");
    document.getElementById("selectionStats").classList.add("d-none");
}

function formatLabel(str) {
    return str
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase())
        .replace("Heart Rate", "HR");
}

function formatDuration(s) {
    if (!s) return "-";
    return `${Math.floor(s / 60)}:${Math.floor(s % 60)
        .toString()
        .padStart(2, "0")}`;
}

init();
