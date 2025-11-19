export class ChartManager {
    constructor(containerId, placeholderId) {
        this.container = document.getElementById(containerId);
        this.placeholder = document.getElementById(placeholderId);
        this.charts = [];
    }

    render(data, onSelect, onHover) {
        this.clear();

        if (!data.fields.length) {
            this.container.innerHTML = `<div class="text-center text-muted mt-5">No chartable data found.</div>`;
            return;
        }

        this.placeholder.classList.add("d-none");
        this.placeholder.classList.remove("d-flex");

        // X Axis: Time in seconds
        const xData = data.records.map((r) =>
            r.timestamp instanceof Date
                ? r.timestamp.getTime() / 1000
                : new Date(r.timestamp).getTime() / 1000
        );

        const sync = uPlot.sync("fitSync");
        const fontSettings =
            "500 11px 'Inter', system-ui, -apple-system, sans-serif";

        data.fields.forEach((field, i) => {
            const div = document.createElement("div");
            div.className = "chart-wrapper";
            this.container.appendChild(div);

            const yData = data.records.map((r) => r[field] ?? null);
            const color = this.getColor(i);

            const u = new uPlot(
                {
                    width: div.clientWidth,
                    height: 180, // Slightly taller for better readability
                    cursor: {
                        sync: { key: sync.key, setSeries: true },
                        drag: { x: true, y: true, uni: 50 },
                        focus: { prox: 30 },
                    },
                    scales: { x: { time: true } },
                    axes: [
                        {
                            font: fontSettings,
                            grid: { show: true, stroke: "#f3f4f6" },
                            ticks: { show: true, stroke: "#e5e7eb" },
                        },
                        {
                            label: this.formatLabel(field),
                            font: fontSettings,
                            stroke: color,
                            size: 60,
                            labelSize: 20,
                            grid: { show: true, stroke: "#f3f4f6" },
                            ticks: { show: true, stroke: "#e5e7eb" },
                        },
                    ],
                    series: [
                        {},
                        {
                            stroke: color,
                            width: 2,
                            fill: color + "10", // Very light fill
                            label: this.formatLabel(field),
                        },
                    ],
                    hooks: {
                        setCursor: [
                            (u) => {
                                if (u.cursor.idx) onHover(u.cursor.idx);
                            },
                        ],
                        setSelect: [
                            (u) => {
                                // Reset Trigger: Width is 0 (double click)
                                if (u.select.width === 0) {
                                    onSelect(null, null);
                                } else {
                                    const min = u.posToVal(u.select.left, "x");
                                    const max = u.posToVal(
                                        u.select.left + u.select.width,
                                        "x"
                                    );
                                    onSelect(min, max);
                                }
                            },
                        ],
                    },
                },
                [xData, yData],
                div
            );

            this.charts.push(u);
        });
    }

    clear() {
        this.charts.forEach((u) => u.destroy());
        this.charts = [];
        this.container.innerHTML = "";
        this.placeholder.classList.remove("d-none");
        this.placeholder.classList.add("d-flex");
    }

    resize() {
        this.charts.forEach((u) => {
            if (u.root && u.root.parentElement) {
                u.setSize({
                    width: u.root.parentElement.clientWidth,
                    height: 180,
                });
            }
        });
    }

    formatLabel(str) {
        return str
            .replace(/_/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase())
            .replace("Heart Rate", "HR")
            .replace("Cadence", "Cad")
            .replace("Altitude", "Alt");
    }

    getColor(i) {
        // Modern, vibrant palette
        const colors = [
            "#2563eb",
            "#dc2626",
            "#d97706",
            "#059669",
            "#7c3aed",
            "#db2777",
            "#4f46e5",
        ];
        return colors[i % colors.length];
    }
}
