/* ═══════ API Fetching ═══════ */

async function fetchKMBETA(stopId) {
  // We keep KMB routed through the Cloudflare proxy to utilize the edge cache
  // as implemented in the wrangler/worker setup.
  const res = await fetch(`/api/eta?stop_id=${stopId}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

async function fetchCTBETA(stopId) {
  const res = await fetch(`https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${stopId}`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json && json.data) ? json.data : [];
}

async function fetchNLBETA(stopId) {
  const res = await fetch(`https://rt.data.gov.hk/v1/transport/batch/stop-eta/NLB/${stopId}`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json && json.data) ? json.data : [];
}

async function etaFetchOne(stop) {
  const op = (stop.op || '').toLowerCase();
  try {
    if (op === 'ctb') return await fetchCTBETA(stop.id);
    if (op === 'nlb') return await fetchNLBETA(stop.id);
    return await fetchKMBETA(stop.id); // Default to KMB
  } catch (err) {
    console.error(`ETA Fetch Error for ${stop.id} (${op}):`, err);
    return [];
  }
}

async function etaFetchBatch(stops) {
  // Deduplicate by stop ID to avoid redundant network calls,
  // while preserving the stop object so we know its operator.
  const uniqueStopsMap = new Map();
  stops.forEach(s => {
    if (!uniqueStopsMap.has(s.id)) uniqueStopsMap.set(s.id, s);
  });

  const uniqueStops = Array.from(uniqueStopsMap.values());
  const promises = uniqueStops.map(stop =>
    etaFetchOne(stop).then(data => ({ id: stop.id, data }))
  );

  const results = await Promise.allSettled(promises);
  const map = {};

  results.forEach(r => {
    if (r.status === 'fulfilled') {
      map[r.value.id] = r.value.data;
    }
  });
  return map;
}

/* ═══════ Data Processing ═══════ */

function etaClass(minutes) {
  if (minutes === null || minutes === undefined) return 'na';
  if (minutes <= 2) return 'hot';
  if (minutes <= 8) return 'warm';
  return 'cool';
}

function etaGroupByRoute(etaDataArray, stopOp) {
    const routes = {};
    const targetOp = (stopOp || '').toLowerCase();

    const validData = etaDataArray.filter(eta => {
        if (eta.eta == null && eta.rm_tc == null) return false;
        const dataOp = (eta.co || targetOp).toLowerCase();
        return dataOp === targetOp;
    });

    validData.forEach(eta => {
        const route = eta.route;
        if (!routes[route]) {
            // SMART MAPPING for destinations
            // CTB/NLB Batch API sometimes uses different keys or requires fallbacks
            const destTc = eta.dest_tc || eta.dest_zh || eta.destination_tc || "未知終點";
            const destEn = eta.dest_en || eta.destination_en || "Unknown Destination";

            routes[route] = {
                route: route,
                dest: { tc: destTc, en: destEn },
                co: eta.co || stopOp,
                times: []
            };
        }

        // Arrival Time Calculation
        if (eta.eta) {
            const etaTime = new Date(eta.eta).getTime();
            const now = Date.now();
            const diffMins = Math.max(0, Math.floor((etaTime - now) / 60000));
            routes[route].times.push(diffMins);
        }
    });

    Object.values(routes).forEach(r => {
        r.times.sort((a, b) => a - b);
        r.times = r.times.slice(0, 3);
    });

    return Object.values(routes);
}
