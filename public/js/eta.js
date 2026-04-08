/* ═══════ API Fetching ═══════ */

async function fetchKMBETA(stopId) {
  const res = await fetch(`/api/eta?stop_id=${stopId}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

async function fetchCTBETA(stopId) {
  const res = await fetch(`https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/${stopId}?lang=zh-hant`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json && json.data) ? json.data : [];
}

async function fetchNLBETA(stopId) {
  const res = await fetch(`https://rt.data.gov.hk/v1/transport/batch/stop-eta/NLB/${stopId}?lang=zh-hant`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json && json.data) ? json.data : [];
}

/**
 * Standardizes raw API data and removes the "static" NLB legal disclaimer.
 */
function standardizeData(rawArray, stopOp) {
  const op = stopOp.toLowerCase();

  // The exact phrases to block entirely
  const BANNED_PHRASES = [
    "actual arrival time is subject",
    "實際到站時間受實時交通情況影響",
    "for reference only",
    "僅供參考"
  ];

  return rawArray.map(e => {
    let rmk = (e.rmk_tc || e.rmk_en || e.rmk || '').trim();

    // Check if it's a "junk" remark
    const isJunk = BANNED_PHRASES.some(phrase =>
      rmk.toLowerCase().includes(phrase.toLowerCase())
    );

    if (isJunk) rmk = '';

    // Truncate useful remarks to 20 chars
    const cleanedRmk = rmk.length > 20
      ? rmk.substring(0, 20) + '...'
      : rmk;

    return {
      route: e.route || '—',
      dest_tc: e.dest_tc || e.destination_tc || e.dest || "未知終點",
      dest_en: e.dest_en || e.destination_en || e.dest || "Unknown Destination",
      eta: e.eta || e.eta_timestamp || null,
      seq: e.eta_seq || e.seq || 0,
      rmk: cleanedRmk,
      co: e.co || op
    };
  });
}

async function etaFetchOne(stop) {
  const op = (stop.op || '').toLowerCase();
  let raw = [];
  try {
    if (op === 'ctb') raw = await fetchCTBETA(stop.id);
    else if (op === 'nlb') raw = await fetchNLBETA(stop.id);
    else raw = await fetchKMBETA(stop.id);

    return standardizeData(raw, op);
  } catch (err) {
    console.error(`Fetch Error: ${stop.id} (${op})`, err);
    return [];
  }
}

/**
 * Orchestrates multiple stop requests while avoiding redundant network calls.
 */
async function etaFetchBatch(stops) {
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

/* ═══════ Data Processing for UI ═══════ */

function etaClass(minutes) {
  if (minutes === null || minutes === undefined) return 'na';
  if (minutes <= 2) return 'hot';
  if (minutes <= 8) return 'warm';
  return 'cool';
}

function etaGroupByRoute(standardizedArray, stopOp) {
  const routes = {};
  const targetOp = stopOp.toLowerCase();

  // Filter for routes belonging to the specific operator at this physical stop
  const filtered = standardizedArray.filter(eta => eta.co.toLowerCase() === targetOp);

  filtered.forEach(eta => {
    if (!routes[eta.route]) {
      routes[eta.route] = {
        route: eta.route,
        dest: { tc: eta.dest_tc, en: eta.dest_en },
        co: eta.co,
        rmk: eta.rmk,
        times: []
      };
    }

    if (eta.eta) {
      const diffMins = Math.max(0, Math.floor((new Date(eta.eta).getTime() - Date.now()) / 60000));
      routes[eta.route].times.push(diffMins);
    }
  });

  Object.values(routes).forEach(r => {
    r.times.sort((a, b) => a - b);
    r.times = r.times.slice(0, 3);
  });

  return Object.values(routes);
}
