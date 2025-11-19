export class MapManager {
    constructor(elementId) {
        this.container = document.getElementById(elementId);
        this.map = L.map("map", { zoomControl: false }).setView([0, 0], 2);
        L.tileLayer(
            "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
            {
                attribution: "&copy; OpenStreetMap",
            }
        ).addTo(this.map);
        L.control.zoom({ position: "bottomright" }).addTo(this.map);

        this.layers = {
            base: L.polyline([], {
                color: "#2563eb",
                weight: 3,
                opacity: 0.5,
            }).addTo(this.map),
            highlight: L.polyline([], {
                color: "#dc2626",
                weight: 4,
                opacity: 1,
            }).addTo(this.map),
            marker: L.circleMarker([0, 0], {
                radius: 6,
                color: "#2563eb",
                fillColor: "#fff",
                fillOpacity: 1,
                opacity: 0,
            }).addTo(this.map),
        };

        this.fullBounds = null;
        this.gpsData = [];
    }

    load(gpsData, bounds) {
        this.gpsData = gpsData;
        this.fullBounds = bounds;

        if (!gpsData.length) {
            this.container.classList.add("d-none");
            return;
        }
        this.container.classList.remove("d-none");

        // Draw Full Trace
        const latlngs = gpsData.map((p) => [p.lat, p.lon]);
        this.layers.base.setLatLngs(latlngs);
        this.layers.highlight.setLatLngs([]); // Clear highlight

        setTimeout(() => {
            this.map.invalidateSize();
            this.map.fitBounds(bounds, { padding: [30, 30] });
        }, 100);
    }

    updateHighlight(subset, isReset) {
        if (!this.gpsData.length) return;

        if (isReset) {
            // Reset: Remove Red line, fit to Blue line
            this.layers.highlight.setLatLngs([]);
            if (this.fullBounds)
                this.map.fitBounds(this.fullBounds, { padding: [30, 30] });
        } else {
            // Highlight: Draw Red line, fit to Red line
            if (!subset.length) return;

            const minTs = subset[0].ts;
            const maxTs = subset[subset.length - 1].ts;

            // Filter GPS points
            const segment = this.gpsData.filter(
                (p) => p.ts >= minTs && p.ts <= maxTs
            );
            const latlngs = segment.map((p) => [p.lat, p.lon]);

            if (latlngs.length) {
                this.layers.highlight.setLatLngs(latlngs);
                this.map.fitBounds(L.latLngBounds(latlngs), {
                    padding: [50, 50],
                });
            }
        }
    }

    setMarker(idx) {
        const p = this.gpsData.find((g) => g.i === idx);
        if (p)
            this.layers.marker
                .setLatLng([p.lat, p.lon])
                .setStyle({ opacity: 1 });
    }

    resize() {
        this.map.invalidateSize();
    }
}
