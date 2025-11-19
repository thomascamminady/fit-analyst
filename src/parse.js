import FitParser from "https://esm.sh/fit-file-parser@1.9.5?bundle";

export async function parseFitData(file) {
    const buffer = await file.arrayBuffer();
    const fitData = await runParser(buffer);

    const rawRecords = fitData.records || [];
    const records = [];
    const gps = [];

    // Track Bounds
    let minLat = 90,
        maxLat = -90,
        minLon = 180,
        maxLon = -180;
    let hasGPS = false;
    let startTime = Infinity;
    let endTime = -Infinity;

    rawRecords.forEach((r, i) => {
        // 1. Normalize Timestamp to seconds (float)
        // This ensures perfect sync between uPlot (charts) and our logic
        const ts =
            r.timestamp instanceof Date
                ? r.timestamp.getTime() / 1000
                : new Date(r.timestamp).getTime() / 1000;

        // 2. Standardize Record
        const record = { ...r, ts: ts, i: i };
        records.push(record);

        if (ts < startTime) startTime = ts;
        if (ts > endTime) endTime = ts;

        // 3. Extract GPS
        if (isValid(r.position_lat) && isValid(r.position_long)) {
            gps.push({
                i: i,
                lat: r.position_lat,
                lon: r.position_long,
                ts: ts,
            });

            if (r.position_lat < minLat) minLat = r.position_lat;
            if (r.position_lat > maxLat) maxLat = r.position_lat;
            if (r.position_long < minLon) minLon = r.position_long;
            if (r.position_long > maxLon) maxLon = r.position_long;
            hasGPS = true;
        }
    });

    // 4. Detect Chartable Fields
    const ignore = new Set([
        "timestamp",
        "ts",
        "i",
        "position_lat",
        "position_long",
        "timer_time",
        "elapsed_time",
        "distance",
        "temperature",
    ]);
    const fields = new Set();
    records.forEach((r) => {
        Object.keys(r).forEach((k) => {
            if (!ignore.has(k) && typeof r[k] === "number") fields.add(k);
        });
    });

    return {
        records: records,
        gps: gps,
        laps: fitData.laps || [],
        sessions: fitData.sessions || [],
        bounds: hasGPS
            ? [
                  [minLat, minLon],
                  [maxLat, maxLon],
              ]
            : null,
        fields: Array.from(fields).sort(),
        startTime: startTime,
        endTime: endTime,
    };
}

function isValid(n) {
    return typeof n === "number" && !isNaN(n);
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
        parser.parse(buffer, (err, data) =>
            err ? reject(err) : resolve(data)
        );
    });
}
