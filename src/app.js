import { parseFitData } from "./parse.js";
import { MapManager } from "./map.js";
import { ChartManager } from "./charts.js";

// --- State ---
const APP = {
    data: null,
    map: new MapManager("mapContainer"),
    charts: new ChartManager("charts-container", "charts-placeholder"),
};

// --- Init ---
function init() {
    document
        .getElementById("fileInput")
        .addEventListener("change", handleUpload);
    window.addEventListener("resize", () => {
        APP.charts.resize();
        APP.map.resize();
    });

    document.querySelectorAll('button[data-bs-toggle="pill"]').forEach((el) => {
        el.addEventListener("shown.bs.tab", () => APP.map.resize());
    });

    document
        .getElementById("explorer-tab")
        .addEventListener("shown.bs.tab", () => {
            if (APP.data) renderExplorer();
        });
}

async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById("loader").style.display = "flex";

    try {
        APP.data = await parseFitData(file);

        document
            .getElementById("fileSelectorWrapper")
            .classList.replace("d-none", "d-flex");
        document.getElementById(
            "fileSelect"
        ).innerHTML = `<option>${file.name}</option>`;

        resetViews();

        // 1. Load Map
        APP.map.load(APP.data.gps, APP.data.bounds);

        // 2. Set Initial State (Reset = Select All)
        updateSelectionState(null, null);

        // 3. Render Charts
        APP.charts.render(
            APP.data,
            (min, max) => updateSelectionState(min, max),
            (idx) => APP.map.setMarker(idx)
        );
    } catch (err) {
        console.error(err);
        alert("Error: " + err.message);
    } finally {
        document.getElementById("loader").style.display = "none";
    }
}

// --- Core Selection Logic ---
function updateSelectionState(minTs, maxTs) {
    if (!APP.data) return;

    const isReset = minTs === null || maxTs === null;
    let subset;

    if (isReset) {
        // Select EVERYTHING
        subset = APP.data.records;
    } else {
        // Filter Subset
        subset = APP.data.records.filter((r) => r.ts >= minTs && r.ts <= maxTs);
    }

    // 1. Summary Table (Shows either Activity Summary or Selection Summary)
    renderAvgTable(subset, isReset);

    // 2. Map (Highlights or Reset)
    APP.map.updateHighlight(subset, isReset);

    // 3. Detailed Records (Only show if specifically selecting a range)
    if (isReset) {
        document
            .getElementById("selectionTableContainer")
            .classList.add("d-none");
    } else {
        renderRecordTable(subset, true);
    }
}

// --- Tables ---
function renderTables() {
    renderLaps(APP.data.laps);
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
        pageLength: 5,
        lengthMenu: [5, 15, 50],
        searching: false,
        ordering: false,
        scrollX: true,
        dom: "<'row'<'col-12'tr>>p",
    });
}

function renderAvgTable(subset, isFullRange) {
    const container = document.getElementById("selectionStats");
    container.classList.remove("d-none");

    const titleEl = container.querySelector("h6");
    if (titleEl)
        titleEl.textContent = isFullRange
            ? "Activity Summary"
            : "Selection Summary";

    const tableId = "#avgTable";
    if ($.fn.DataTable.isDataTable(tableId)) {
        $(tableId).DataTable().destroy();
        document.querySelector(tableId).innerHTML = "";
    }

    if (!subset.length) return;

    const first = subset[0];
    const last = subset[subset.length - 1];
    const duration = last.ts - first.ts;
    const dist = (last.distance || 0) - (first.distance || 0);

    const rowData = { duration, dist };
    APP.data.fields.forEach((k) => {
        const valid = subset.filter((r) => typeof r[k] === "number");
        rowData[k] = valid.length
            ? valid.reduce((a, b) => a + b[k], 0) / valid.length
            : 0;
    });

    const cols = [
        {
            title: "Duration",
            data: "duration",
            render: (d) => formatDuration(d),
        },
        { title: "Distance", data: "dist", render: (d) => d.toFixed(2) },
    ];
    APP.data.fields.forEach((k) => {
        cols.push({
            title: "Avg " + formatLabel(k),
            data: k,
            render: (d) => d.toFixed(1),
        });
    });

    $(tableId).DataTable({
        data: [rowData],
        columns: cols,
        dom: "t",
        paging: false,
        ordering: false,
        scrollX: true,
    });

    renderLaps(APP.data.laps);
}

function renderLaps(laps) {
    const container = document.getElementById("lapsContainer");
    if (!laps.length) {
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
        scrollX: true,
        scrollY: "200px",
    });
}

function renderExplorer() {
    const type = document.querySelector('input[name="dataView"]:checked').value;
    if (type === "records") renderRecordTable(APP.data.records, false);
}

function resetViews() {
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
