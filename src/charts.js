export class ChartManager {
    constructor(containerId, placeholderId) {
        this.container = document.getElementById(containerId);
        this.placeholder = document.getElementById(placeholderId);
        this.charts = [];
    }

    render(data, onSelect, onHover) {
        this.clear();
        if (!data.fields.length) return;

        this.placeholder.classList.replace("d-flex", "d-none");

        const xData = data.records.map((r) => r.ts);
        const sync = uPlot.sync("fitSync");

        data.fields.forEach((field, i) => {
            const div = document.createElement("div");
            div.className = "chart-wrapper";
            this.container.appendChild(div);

            const yData = data.records.map((r) => r[field] ?? null);
            const color = this.getColor(i);

            const u = new uPlot(
                {
                    width: div.clientWidth,
                    height: 180,
                    cursor: {
                        sync: { key: sync.key, setSeries: true },
                        drag: { x: true, y: true, uni: 50 },
                        focus: { prox: 30 },
                    },
                    scales: { x: { time: true } },
                    axes: [
                        {
                            font: "11px 'Inter'",
                            grid: { stroke: "#f3f4f6" },
                            ticks: { stroke: "#e5e7eb" },
                        },
                        {
                            label: this.formatLabel(field),
                            font: "11px 'Inter'",
                            stroke: color,
                            size: 60,
                            grid: { stroke: "#f3f4f6" },
                            ticks: { stroke: "#e5e7eb" },
                        },
                    ],
                    series: [
                        {},
                        { stroke: color, width: 2, fill: color + "10" },
                    ],
                    hooks: {
                        setCursor: [
                            (u) => {
                                if (u.cursor.idx) onHover(u.cursor.idx);
                            },
                        ],
                        setSelect: [
                            (u) => {
                                // Only trigger selection if width > 0
                                // (Double click width=0 is handled by event listener below)
                                if (u.select.width > 0) {
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

            // Explicitly listen for double click to Reset
            u.over.addEventListener("dblclick", () => {
                onSelect(null, null);
            });

            this.charts.push(u);
        });
    }

    clear() {
        this.charts.forEach((u) => u.destroy());
        this.charts = [];
        this.container.innerHTML = "";
        this.placeholder.classList.replace("d-none", "d-flex");
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
        return [
            "#2563eb",
            "#dc2626",
            "#d97706",
            "#059669",
            "#7c3aed",
            "#db2777",
        ][i % 6];
    }
}
