// Initialize Dexie database
const db = new Dexie('HKBusDB');

db.version(1).stores({
  stops: 'id, en, tc, op, lat, lng',
  meta:  'key',
});

window.db = db; // Force global availability
async function dbCheckFreshness() {
  const count = await db.stops.count();
  if (count === 0) return false;

  const meta = await db.meta.get('lastSync');
  if (!meta || !meta.ts) return false;

  const ageMs = Date.now() - meta.ts;
  return ageMs < CONFIG.DATA_MAX_AGE_MS;
}

async function dbSyncStops() {
  try {
    const res = await fetch(CONFIG.STOPS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const schema = json.schema;

    // Reconstruct objects from positional array
    const stops = json.data.map(row => {
      const obj = {};
      schema.forEach((key, i) => obj[key] = row[i]);
      return obj;
    });

    // Replace data in a single transaction
    await db.transaction('rw', db.stops, db.meta, async () => {
      await db.stops.clear();
      await db.stops.bulkAdd(stops);
      await db.meta.put({
        key: 'lastSync',
        ts: Date.now(),
        generated_at: json.generated_at
      });
    });

    return true;
  } catch (err) {
    console.error("Sync failed:", err);
    return false;
  }
}

async function dbEnsureData() {
  const isFresh = await dbCheckFreshness();
  if (!isFresh) {
    const success = await dbSyncStops();
    if (!success) {
      const count = await db.stops.count();
      if (count === 0) throw new Error("No data available and sync failed.");
      console.warn("Using stale data due to sync failure.");
    }
  }
}

async function dbQueryBBox(lat, lng, radiusMeters) {
  const dLat = radiusMeters * CONFIG.LAT_PER_METER;
  const dLng = radiusMeters * CONFIG.LNG_PER_METER;

  // Query within latitude bounds, then filter by longitude
  return await db.stops
    .where('lat').between(lat - dLat, lat + dLat)
    .and(s => s.lng >= lng - dLng && s.lng <= lng + dLng)
    .toArray();
}
