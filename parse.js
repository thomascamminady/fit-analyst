import FitParser from "https://esm.sh/fit-file-parser@1.9.5?bundle";

export async function parseFitData(file) {
    const buffer = await file.arrayBuffer();
    const fitData = await runParser(buffer);

    const records = fitData.records || [];

    // 1. Extract GPS Trace & Bounds once
    const gps = [];
    let minLat = 90,
        maxLat = -90,
        minLon = 180,
        maxLon = -180;

    records.forEach((r, index) => {
        // Check for valid coordinates
        if (isValid(r.position_lat) && isValid(r.position_long)) {
            // Normalize timestamp to seconds
            const ts =
                r.timestamp instanceof Date
                    ? r.timestamp.getTime() / 1000
                    : new Date(r.timestamp).getTime() / 1000;

            gps.push({
                i: index,
                lat: r.position_lat,
                lon: r.position_long,
                ts: ts,
            });

            if (r.position_lat < minLat) minLat = r.position_lat;
            if (r.position_lat > maxLat) maxLat = r.position_lat;
            if (r.position_long < minLon) minLon = r.position_long;
            if (r.position_long > maxLon) maxLon = r.position_long;
        }
    });

    // 2. Dynamically detect numeric fields for charts
    // We exclude standard fields that shouldn't be charted as Y-values
    const ignoreFields = new Set([
        "timestamp",
        "position_lat",
        "position_long",
        "timer_time",
        "elapsed_time",
        "distance",
        "temperature",
        "altitude",
    ]);

    // Explicitly include Altitude if you want it charted, otherwise remove from ignore list
    // Usually people want Altitude charted, so let's allow it:
    ignoreFields.delete("altitude");

    const fieldSet = new Set();
    records.forEach((r) => {
        Object.keys(r).forEach((k) => {
            if (!ignoreFields.has(k) && typeof r[k] === "number") {
                fieldSet.add(k);
            }
        });
    });

    // Sort fields alphabetically for consistent UI
    const sortedFields = Array.from(fieldSet).sort();

    return {
        raw: fitData,
        records: records,
        laps: fitData.laps || [],
        sessions: fitData.sessions || [],
        gps: gps,
        bounds: gps.length
            ? [
                  [minLat, minLon],
                  [maxLat, maxLon],
              ]
            : null,
        fields: sortedFields,
    };
}

function isValid(num) {
    return typeof num === "number" && !isNaN(num);
}

function runParser(buffer) {
    return new Promise((resolve, reject) => {
        const parser = new FitParser({
            force: true,
            speedUnit: "km/h",
            lengthUnit: "km",
            temperatureUnit: "celsius",
            elapsedRecordField: true,
            mode: "both",
        });
        parser.parse(buffer, (err, data) => {
            if (err) reject(err);
            else resolve(data);
        });
    });
}
