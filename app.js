import FitParser from "https://esm.sh/fit-file-parser@1.9.5?bundle";

// --- State ---
const APP = {
    files: {},
    activeFile: null,
    map: null,
    polyline: null,
    positionMarker: null, // The hovering blue dot
    gpsData: [], // {ts, lat, lon}
    records: [], // Current full records array
    charts: [],
    syncKey: null,
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
    statsGrid: document.getElementById("stats-grid"),

    chartsContainer: document.getElementById("charts-container"),
    chartsPlaceholder: document.getElementById("charts-placeholder"),

    datatableEl: document.getElementById("datatable"),
    radioInputs: document.querySelectorAll('input[name="dataView"]'),
};

// --- Init ---
function init() {
    // Init Map
    APP.map = L.map("map", { zoomControl: false }).setView([0, 0], 2);
    L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        {
            attribution: "&copy; OpenStreetMap, &copy; CartoDB",
        }
    ).addTo(APP.map);
    L.control.zoom({ position: "bottomright" }).addTo(APP.map);

    // Listeners
    UI.fileInput.addEventListener("change", handleUpload);
    UI.fileSelect.addEventListener("change", (e) => switchFile(e.target.value));
    UI.btnDownload.addEventListener("click", downloadAllFiles);
    UI.radioInputs.forEach((radio) =>
        radio.addEventListener("change", renderExplorer)
    );

    // Fix map size when tab changes
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

    // Clean up
    APP.charts.forEach((u) => u.destroy());
    APP.charts = [];
    UI.chartsContainer.innerHTML = "";

    // Render Views
    renderMap(data.records);
    renderLaps(data.laps);
    renderCharts(data.records);

    // Reset Stats
    UI.statsContainer.classList.add("d-none");

    // Update Explorer if active
    if (document.getElementById("explorer").classList.contains("active")) {
        renderExplorer();
    }
}

// --- MAP LOGIC ---
function renderMap(records) {
    APP.gpsData = [];
    const latLongs = [];

    // Pre-process GPS data for fast lookup
    records.forEach((r, i) => {
        if (r.position_lat && r.position_long) {
            // Store index to sync with charts easily
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

        // Remove old layers
        if (APP.polyline) APP.map.removeLayer(APP.polyline);
        if (APP.positionMarker) APP.map.removeLayer(APP.positionMarker);

        // Add Track
        APP.polyline = L.polyline(latLongs, {
            color: "#2563eb",
            weight: 3,
            opacity: 0.8,
        }).addTo(APP.map);

        // Add Sync Marker (hidden initially)
        APP.positionMarker = L.circleMarker([0, 0], {
            radius: 6,
            fillColor: "#fff",
            color: "#2563eb",
            weight: 3,
            opacity: 0, // Init hidden
            fillOpacity: 0, // Init hidden
        }).addTo(APP.map);

        // Important: fix zoom
        setTimeout(() => {
            APP.map.invalidateSize();
            APP.map.fitBounds(APP.polyline.getBounds(), { padding: [30, 30] });
        }, 100);
    } else {
        UI.mapContainer.classList.add("d-none");
    }
}

// Syncs cursor from Chart -> Map
function syncMapCursor(idx) {
    if (!APP.gpsData.length || !APP.positionMarker) return;

    // Find the gps point closest to this record index
    const point =
        APP.gpsData.find((p) => p.i === idx) ||
        APP.gpsData.find((p) => p.i > idx - 5 && p.i < idx + 5);

    if (point) {
        APP.positionMarker.setLatLng([point.lat, point.lon]);
        // FIXED: Use setStyle instead of setOpacity for CircleMarker
        APP.positionMarker.setStyle({ opacity: 1, fillOpacity: 1 });
    } else {
        APP.positionMarker.setStyle({ opacity: 0, fillOpacity: 0 });
    }
}

// --- CHARTS LOGIC ---
function renderCharts(records) {
    if (!records || records.length === 0) return;
    UI.chartsPlaceholder.style.display = "none";

    const ignore = [
        "timestamp",
        "position_lat",
        "position_long",
        "elapsed_time",
        "distance",
        "timer_time",
    ];
    // Filter fields that have numeric data
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
                title: "", // No top title
                cursor: {
                    sync: { key: sync.key, setSeries: true },
                    focus: { prox: 30 },
                    drag: { x: true, y: true, uni: 50 },
                },
                scales: { x: { time: true } },
                axes: [
                    {}, // X axis default
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
        return;
    }

    const minX = u.posToVal(u.select.left, "x");
    const maxX = u.posToVal(u.select.left + u.select.width, "x");

    // Filter records in range
    const subset = APP.records.filter((r) => {
        const t = new Date(r.timestamp).getTime() / 1000;
        return t >= minX && t <= maxX;
    });

    if (subset.length === 0) return;

    UI.statsContainer.classList.remove("d-none");

    // Calculate averages for interesting fields
    const fields = ["speed", "heart_rate", "power", "cadence"];
    let html = "";

    fields.forEach((f) => {
        const valid = subset.filter((r) => typeof r[f] === "number");
        if (valid.length > 0) {
            const sum = valid.reduce((acc, r) => acc + r[f], 0);
            const avg = sum / valid.length;
            html += `
                <div class="stat-card">
                    <div class="stat-label">${formatLabel(f)}</div>
                    <div class="stat-value">${avg.toFixed(1)}</div>
                </div>`;
        }
    });

    UI.statsGrid.innerHTML = html;
}

// --- TABLES LOGIC ---
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
        { title: "#", data: null, render: (d, t, r, m) => m.row + 1 },
        {
            title: "Time",
            data: "total_elapsed_time",
            render: (d) => formatDuration(d),
        },
        {
            title: "Dist",
            data: "total_distance",
            render: (d) => (d || 0).toFixed(2) + " km",
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
            title: "Speed",
            data: "avg_speed",
            render: (d) => (d || 0).toFixed(1),
        },
    ];

    $("#lapSummaryTable").DataTable({
        data: laps,
        columns: columns,
        paging: false,
        searching: false,
        info: false,
        ordering: false,
        scrollY: "300px",
        scrollCollapse: true,
    });
}

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
    // Limit columns for performance if too many keys
    const visibleKeys = keys.slice(0, 15);

    const columns = visibleKeys.map((k) => ({
        title: k.replace(/_/g, " "),
        data: k,
        defaultContent: "-",
        render: function (d) {
            if (typeof d === "object" && d !== null) return "[obj]";
            if (typeof d === "string" && d.includes("T") && d.length > 18)
                return d.split("T")[1].replace("Z", "");
            if (typeof d === "number") return Math.round(d * 100) / 100;
            return d;
        },
    }));

    $("#datatable").DataTable({
        data: dataset,
        columns: columns,
        pageLength: 10,
        lengthMenu: [10, 25, 50],
        scrollX: true,
        autoWidth: false,
        dom:
            "<'row mb-2'<'col-6'l><'col-6'f>>" +
            "<'row'<'col-12'tr>>" +
            "<'row mt-2'<'col-6'i><'col-6'p>>",
    });
}

// --- Utilities ---
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

function toCSV(arr) {
    if (!arr.length) return "";
    const headers = Object.keys(arr[0]);
    const rows = arr.map((obj) =>
        headers
            .map((h) => `"${String(obj[h] ?? "").replace(/"/g, '""')}"`)
            .join(",")
    );
    return [headers.join(","), ...rows].join("\n");
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
    if (key.includes("heart")) return "#ef4444"; // Red
    if (key.includes("speed")) return "#3b82f6"; // Blue
    if (key.includes("power")) return "#f59e0b"; // Amber
    if (key.includes("cadence")) return "#8b5cf6"; // Purple
    if (key.includes("alt")) return "#10b981"; // Green
    return "#6b7280"; // Gray
}

window.addEventListener("resize", () => {
    APP.charts.forEach((u) => {
        const div = u.root.parentElement;
        u.setSize({ width: div.clientWidth, height: 160 });
    });
});

init();
