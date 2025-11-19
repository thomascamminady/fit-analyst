import FitParser from "https://esm.sh/fit-file-parser@1.9.5?bundle";

// --- State ---
const APP = {
    files: {},
    activeFile: null,
    map: null,
    polyline: null,
    positionMarker: null,
    gpsData: [],
    records: [],
    charts: [],
    syncKey: null,
    currentSelection: [],
};

// --- UI References ---
const UI = {
    loader: document.getElementById("loader"),
    fileInput: document.getElementById("fileInput"),
    fileSelect: document.getElementById("fileSelect"),
    fileSelectWrapper: document.getElementById("fileSelectorWrapper"),
    btnDownload: document.getElementById("btnDownload"),

    mapContainer: document.getElementById("mapContainer"),
    lapsContainer: document.getElementById("lapsContainer"),
    statsContainer: document.getElementById("selectionStats"),

    chartsContainer: document.getElementById("charts-container"),
    chartsPlaceholder: document.getElementById("charts-placeholder"),

    selectionTableContainer: document.getElementById("selectionTableContainer"),
    selectionCountBadge: document.getElementById("selectionCountBadge"),

    datatableEl: document.getElementById("datatable"),
    radioInputs: document.querySelectorAll('input[name="dataView"]'),

    copyAvgBtn: document.getElementById("copyAvgBtn"),
    copyLapsBtn: document.getElementById("copyLapsBtn"),
    copySelBtn: document.getElementById("copySelBtn"),
    copyExplorerBtn: document.getElementById("copyExplorerBtn"),
};

// --- Init ---
function init() {
    APP.map = L.map("map", { zoomControl: false }).setView([0, 0], 2);
    L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        {
            attribution: "&copy; OpenStreetMap, &copy; CartoDB",
        }
    ).addTo(APP.map);
    L.control.zoom({ position: "bottomright" }).addTo(APP.map);

    UI.fileInput.addEventListener("change", handleUpload);
    UI.fileSelect.addEventListener("change", (e) => switchFile(e.target.value));
    UI.btnDownload.addEventListener("click", downloadAllFiles);
    UI.radioInputs.forEach((radio) =>
        radio.addEventListener("change", renderExplorer)
    );

    UI.copyAvgBtn.addEventListener("click", () =>
        copyTableToClipboard("avgTable")
    );
    UI.copyLapsBtn.addEventListener("click", () =>
        copyTableToClipboard("lapSummaryTable")
    );
    UI.copySelBtn.addEventListener("click", () =>
        copyDataArray(APP.currentSelection)
    );
    UI.copyExplorerBtn.addEventListener("click", () =>
        copyTableToClipboard("datatable")
    );

    document.querySelectorAll('button[data-bs-toggle="pill"]').forEach((el) => {
        el.addEventListener("shown.bs.tab", () => {
            APP.map.invalidateSize();
            if (APP.polyline) APP.map.fitBounds(APP.polyline.getBounds());
        });
    });
}

// --- Parsing ---
async function handleUpload(e) {
    const files = e.target.files;
    if (!files.length) return;

    UI.loader.style.display = "flex";
    APP.files = {};
    UI.fileSelect.innerHTML = "";

    try {
        for (const file of files) {
            const data = await parseFitFile(file);
            APP.files[file.name] = data;

            const option = document.createElement("option");
            option.value = file.name;
            option.text = file.name;
            UI.fileSelect.appendChild(option);
        }

        if (Object.keys(APP.files).length > 0) {
            UI.fileSelectWrapper.classList.remove("d-none");
            UI.fileSelectWrapper.classList.add("d-flex");
            UI.btnDownload.disabled = false;
            switchFile(Object.keys(APP.files)[0]);
        }
    } catch (err) {
        console.error(err);
        alert("Error: " + err.message);
    } finally {
        UI.loader.style.display = "none";
    }
}

function parseFitFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const parser = new FitParser({
                force: true,
                speedUnit: "km/h",
                lengthUnit: "km",
                temperatureUnit: "celsius",
                elapsedRecordField: true,
                mode: "both",
            });
            parser.parse(e.target.result, (err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// --- Switching Files ---
function switchFile(fileName) {
    APP.activeFile = fileName;
    const data = APP.files[fileName];
    APP.records = data.records || [];
    APP.currentSelection = [];

    APP.charts.forEach((u) => u.destroy());
    APP.charts = [];
    UI.chartsContainer.innerHTML = "";
    UI.selectionTableContainer.classList.add("d-none");
    UI.statsContainer.classList.add("d-none");

    UI.chartsPlaceholder.classList.remove("d-none");
    UI.chartsPlaceholder.classList.add("d-flex");

    renderMap(data.records);
    renderLaps(data.laps);
    renderCharts(data.records);

    if (document.getElementById("explorer").classList.contains("active")) {
        renderExplorer();
    }
}

// --- MAP ---
function renderMap(records) {
    APP.gpsData = [];
    const latLongs = [];

    records.forEach((r, i) => {
        if (r.position_lat && r.position_long) {
            APP.gpsData.push({
                i: i,
                lat: r.position_lat,
                lon: r.position_long,
            });
            latLongs.push([r.position_lat, r.position_long]);
        }
    });

    if (latLongs.length > 0) {
        UI.mapContainer.classList.remove("d-none");

        if (APP.polyline) APP.map.removeLayer(APP.polyline);
        if (APP.positionMarker) APP.map.removeLayer(APP.positionMarker);

        APP.polyline = L.polyline(latLongs, {
            color: "#2563eb",
            weight: 3,
            opacity: 0.8,
        }).addTo(APP.map);

        APP.positionMarker = L.circleMarker([0, 0], {
            radius: 6,
            fillColor: "#fff",
            color: "#2563eb",
            weight: 3,
            opacity: 0,
            fillOpacity: 0,
        }).addTo(APP.map);

        setTimeout(() => {
            APP.map.invalidateSize();
            APP.map.fitBounds(APP.polyline.getBounds(), { padding: [30, 30] });
        }, 100);
    } else {
        UI.mapContainer.classList.add("d-none");
    }
}

function syncMapCursor(idx) {
    if (!APP.gpsData.length || !APP.positionMarker) return;

    const point =
        APP.gpsData.find((p) => p.i === idx) ||
        APP.gpsData.find((p) => p.i > idx - 5 && p.i < idx + 5);

    if (point) {
        APP.positionMarker.setLatLng([point.lat, point.lon]);
        APP.positionMarker.setStyle({ opacity: 1, fillOpacity: 1 });
    } else {
        APP.positionMarker.setStyle({ opacity: 0, fillOpacity: 0 });
    }
}

// --- CHARTS ---
function renderCharts(records) {
    if (!records || records.length === 0) return;

    UI.chartsPlaceholder.classList.remove("d-flex");
    UI.chartsPlaceholder.classList.add("d-none");

    const ignore = [
        "timestamp",
        "position_lat",
        "position_long",
        "elapsed_time",
        "distance",
        "timer_time",
    ];
    const keys = Object.keys(records[0]).filter((k) => {
        if (ignore.includes(k)) return false;
        return records.some((r) => typeof r[k] === "number");
    });

    const xData = records.map((r) => new Date(r.timestamp).getTime() / 1000);
    const sync = uPlot.sync("appSync");

    keys.forEach((key) => {
        const yData = records.map((r) => r[key] ?? null);
        const color = getChartColor(key);

        const div = document.createElement("div");
        div.className = "chart-wrapper";
        UI.chartsContainer.appendChild(div);

        const u = new uPlot(
            {
                width: div.clientWidth,
                height: 160,
                title: "",
                cursor: {
                    sync: { key: sync.key, setSeries: true },
                    focus: { prox: 30 },
                    drag: { x: true, y: true, uni: 50 },
                },
                scales: { x: { time: true } },
                axes: [
                    {},
                    {
                        label: formatLabel(key),
                        labelSize: 20,
                        stroke: color,
                        font: "10px Inter",
                        size: 50,
                    },
                ],
                series: [
                    {},
                    {
                        stroke: color,
                        width: 1.5,
                        fill: color + "10",
                        label: formatLabel(key),
                    },
                ],
                hooks: {
                    setCursor: [
                        (u) => {
                            if (u.cursor.idx != null)
                                syncMapCursor(u.cursor.idx);
                        },
                    ],
                    setSelect: [
                        (u) => {
                            updateSelectionStats(u);
                        },
                    ],
                },
            },
            [xData, yData],
            div
        );

        APP.charts.push(u);
    });
}

function updateSelectionStats(u) {
    if (u.select.width === 0) {
        UI.statsContainer.classList.add("d-none");
        UI.selectionTableContainer.classList.add("d-none");
        APP.currentSelection = [];
        return;
    }

    const minX = u.posToVal(u.select.left, "x");
    const maxX = u.posToVal(u.select.left + u.select.width, "x");

    const subset = APP.records.filter((r) => {
        const t = new Date(r.timestamp).getTime() / 1000;
        return t >= minX && t <= maxX;
    });

    if (subset.length === 0) return;
    APP.currentSelection = subset;

    renderAvgTable(subset);
    renderSelectionTable(subset);
}

// Renders a single row summarizing the selection, matching Lap table columns
function renderAvgTable(subset) {
    UI.statsContainer.classList.remove("d-none");

    // Calculate Aggregates
    const first = subset[0];
    const last = subset[subset.length - 1];
    const duration =
        (new Date(last.timestamp) - new Date(first.timestamp)) / 1000;

    // Distance diff (handle if distance field missing)
    const dist =
        last.distance && first.distance ? last.distance - first.distance : 0;

    const avg = (key) => {
        const valid = subset.filter((r) => typeof r[key] === "number");
        if (!valid.length) return null;
        return valid.reduce((a, b) => a + b[key], 0) / valid.length;
    };

    const rowData = [
        {
            index: "AVG",
            total_elapsed_time: duration,
            total_distance: dist,
            avg_heart_rate: avg("heart_rate"),
            avg_speed: avg("speed"),
            avg_power: avg("power"),
            avg_cadence: avg("cadence"),
        },
    ];

    if ($.fn.DataTable.isDataTable("#avgTable")) {
        $("#avgTable").DataTable().destroy();
    }

    // Unified Columns config shared with renderLaps logic ideally
    const columns = [
        { title: "#", data: "index", width: "10%" },
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
            title: "Avg Spd",
            data: "avg_speed",
            render: (d) => (d || 0).toFixed(1),
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

    $("#avgTable").DataTable({
        data: rowData,
        columns: columns,
        paging: false,
        searching: false,
        info: false,
        ordering: false,
        dom: "t", // Just the table
    });
}

function renderLaps(laps) {
    const table = $("#lapSummaryTable");
    if ($.fn.DataTable.isDataTable("#lapSummaryTable")) {
        table.DataTable().destroy();
    }
    document.getElementById("lapSummaryTable").innerHTML = "";

    if (!laps || laps.length === 0) {
        UI.lapsContainer.classList.add("d-none");
        return;
    }
    UI.lapsContainer.classList.remove("d-none");

    const columns = [
        {
            title: "#",
            data: null,
            width: "10%",
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
            title: "Avg HR",
            data: "avg_heart_rate",
            render: (d) => (d ? Math.round(d) : "-"),
        },
        {
            title: "Avg Spd",
            data: "avg_speed",
            render: (d) => (d || 0).toFixed(1),
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

function renderSelectionTable(data) {
    UI.selectionTableContainer.classList.remove("d-none");
    UI.selectionCountBadge.textContent = `${data.length} records`;

    if ($.fn.DataTable.isDataTable("#selectionTable")) {
        $("#selectionTable").DataTable().destroy();
        document.getElementById("selectionTable").innerHTML = "";
    }

    const keys = Object.keys(data[0]).filter((k) =>
        [
            "timestamp",
            "distance",
            "speed",
            "power",
            "heart_rate",
            "cadence",
            "altitude",
        ].includes(k)
    );

    const columns = keys.map((k) => ({
        title: formatLabel(k),
        data: k,
        defaultContent: "-",
        render: function (d) {
            if (typeof d === "number") return Math.round(d * 10) / 10;
            if (typeof d === "string" && d.includes("T"))
                return d.split("T")[1].replace("Z", "");
            return d;
        },
    }));

    $("#selectionTable").DataTable({
        data: data,
        columns: columns,
        pageLength: 5,
        lengthMenu: [5, 10, 25, 100],
        ordering: false,
        searching: false,
        dom: "<'row'<'col-12'tr>>" + "<'row mt-2 small'<'col-6'i><'col-6'p>>",
    });
}

// --- EXPLORER ---
function renderExplorer() {
    const viewType = document.querySelector(
        'input[name="dataView"]:checked'
    ).value;
    const data = APP.files[APP.activeFile];
    if (!data) return;

    if (viewType === "raw") {
        document
            .getElementById("explorer-table-container")
            .classList.add("d-none");
        document
            .getElementById("explorer-json-container")
            .classList.remove("d-none");
        document.getElementById("json-code").textContent = JSON.stringify(
            data,
            null,
            2
        );
        hljs.highlightElement(document.getElementById("json-code"));
        return;
    }

    document
        .getElementById("explorer-table-container")
        .classList.remove("d-none");
    document.getElementById("explorer-json-container").classList.add("d-none");

    const dataset = data[viewType];
    if (!dataset || !dataset.length) {
        UI.datatableEl.innerHTML = "";
        return;
    }

    if ($.fn.DataTable.isDataTable("#datatable")) {
        $("#datatable").DataTable().destroy();
        UI.datatableEl.innerHTML = "";
    }

    const keys = Object.keys(dataset[0]);
    const visibleKeys = keys.slice(0, 15);

    const columns = visibleKeys.map((k) => ({
        title: k.replace(/_/g, " "),
        data: k,
        defaultContent: "-",
        render: function (d) {
            if (typeof d === "number") return Math.round(d * 100) / 100;
            if (typeof d === "string" && d.length > 10 && d.includes("T"))
                return d.split("T")[1].replace("Z", "");
            if (typeof d === "object" && d !== null) return "{...}";
            return d;
        },
    }));

    $("#datatable").DataTable({
        data: dataset,
        columns: columns,
        pageLength: 15,
        lengthMenu: [15, 50, 100],
        scrollX: true,
        deferRender: true,
        orderClasses: false,
        autoWidth: false,
        dom:
            "<'row mb-2'<'col-6'l><'col-6'f>>" +
            "<'row'<'col-12'tr>>" +
            "<'row mt-2'<'col-6'i><'col-6'p>>",
    });
}

// --- UTILS ---
async function copyTableToClipboard(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;

    let csv = [];
    // Get headers
    const thead = table.querySelector("thead");
    if (thead) {
        const headers = [];
        thead
            .querySelectorAll("th")
            .forEach((th) => headers.push(th.innerText));
        csv.push(headers.join("\t"));
    }

    // Get body rows
    const rows = table.querySelectorAll("tbody tr");
    rows.forEach((row) => {
        const cols = row.querySelectorAll("td");
        if (cols.length === 0) return; // skip empty/loading
        const rowData = [];
        cols.forEach((col) => rowData.push(col.innerText));
        csv.push(rowData.join("\t"));
    });

    await navigator.clipboard.writeText(csv.join("\n"));

    // Visual feedback
    const btn =
        document.querySelector(
            `button[id*="${tableId.replace("Table", "").toLowerCase()}"]`
        ) || document.getElementById("copyExplorerBtn");

    if (btn) {
        const original = btn.innerHTML;
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="#198754" class="bi bi-check-lg" viewBox="0 0 16 16"><path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022Z"/></svg>`;
        setTimeout(() => (btn.innerHTML = original), 1500);
    }
}

async function copyDataArray(arr) {
    if (!arr || !arr.length) return;
    const csv = toCSV(arr, "\t");
    await navigator.clipboard.writeText(csv);

    const btn = document.getElementById("copySelBtn");
    const original = btn.innerHTML;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="#198754" class="bi bi-check-lg" viewBox="0 0 16 16"><path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022Z"/></svg>`;
    setTimeout(() => (btn.innerHTML = original), 1500);
}

async function downloadAllFiles() {
    const zip = new JSZip();
    for (const [name, data] of Object.entries(APP.files)) {
        const folder = zip.folder(name);
        if (data.records) folder.file("records.csv", toCSV(data.records));
        if (data.laps) folder.file("laps.csv", toCSV(data.laps));
        if (data.sessions) folder.file("sessions.csv", toCSV(data.sessions));
    }
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "fit_export.zip");
}

function toCSV(arr, delimiter = ",") {
    if (!arr.length) return "";
    const headers = Object.keys(arr[0]);
    const rows = arr.map((obj) =>
        headers
            .map((h) => `"${String(obj[h] ?? "").replace(/"/g, '""')}"`)
            .join(delimiter)
    );
    return [headers.join(delimiter), ...rows].join("\n");
}

function formatLabel(str) {
    return str
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase())
        .replace("Heart Rate", "HR")
        .replace("Cadence", "Cad");
}

function formatDuration(seconds) {
    if (!seconds) return "-";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function getChartColor(key) {
    if (key.includes("heart")) return "#ef4444";
    if (key.includes("speed")) return "#3b82f6";
    if (key.includes("power")) return "#f59e0b";
    if (key.includes("cadence")) return "#8b5cf6";
    if (key.includes("alt")) return "#10b981";
    return "#6b7280";
}

window.addEventListener("resize", () => {
    APP.charts.forEach((u) => {
        const div = u.root.parentElement;
        u.setSize({ width: div.clientWidth, height: 160 });
    });
});

init();
