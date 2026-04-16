window.appState = {
  centerLat: null,
  centerLng: null,
  radius: CONFIG.DEFAULT_RADIUS,
  nearbyStops: [],
  intervalId: null,
  isMapMoving: false
};

// ETA info keep for 2 mins for non-starred routes
window.etaCache = {
  _data: {},
  set(id, route, data) {
    this._data[`${id}:${route}`] = { data, ts: Date.now() };
  },
  get(id, route) {
    const entry = this._data[`${id}:${route}`];
    if (!entry) return null;
    // Keep for 2 minutes (120,000ms)
    if (Date.now() - entry.ts > 120000) return null;
    return entry.data;
  }
};

// Global callback for UI/Map interactions
window.AppSetCenter = async function(lat, lng, isFromMapMove = false) {
  if (window.appState.isMapMoving) return;

  window.appState.centerLat = lat;
  window.appState.centerLng = lng;
  // If user moved map, adjust radius roughly based on zoom
  if (isFromMapMove && window.map) {
    const z = window.map.getZoom();
    if (z >= 18) window.appState.radius = 150;
    else if (z <= 16) window.appState.radius = 300;
    else window.appState.radius = 200;
  }
  await executeSearch();
};

window.AppRefresh = async function() {
  await executeSearch(true); // true = soft refresh (re-render with cached state + live stars)
};

async function executeSearch(isSoftRefresh = false) {
  //If map is moving, skip this update cycle
  if (appState.isMapMoving|| !appState.centerLat || !appState.centerLng) return;

  if (!isSoftRefresh) {
    uiShowMessage('querying');
    try {
      let stops = await dbQueryBBox(appState.centerLat, appState.centerLng, appState.radius);
      appState.nearbyStops = geoEnrichAndSort(stops, appState.centerLat, appState.centerLng);
      mapRefreshStops(appState.nearbyStops);
    } catch (e) {
      console.error(e);
      uiShowMessage('dbError');
      return;
    }
  }

  if (appState.nearbyStops.length === 0) {
    uiShowMessage('noStopsNearby');
    return;
  }

  uiHideMessage();

  // 1. Identify which stops we need ETA for.
  const targetStops = [];
  const CLUSTER_THRESHOLD = 5; // 5 meters
  const minDistance = Math.min(...appState.nearbyStops.map(s => s.dist));

  // Add nearest stops (we push the whole object so eta.js knows the operator)
  appState.nearbyStops.forEach(s => {
      if (s.dist <= minDistance + CLUSTER_THRESHOLD) {
          targetStops.push({ id: s.id, op: s.op });
      }
  });

  // Add ALL starred stops to targets (even if out of range)
  // We must fetch them from IndexedDB to get their operator code.
  for (const key of Array.from(Stars._set)) {
    const stopId = key.split(':');

    // Only query DB if it's not already in our target list
    if (!targetStops.some(s => s.id === stopId)) {
      const stopRecord = await db.stops.get(stopId);
      if (stopRecord) {
        targetStops.push({ id: stopRecord.id, op: stopRecord.op });
      }
    }
  }

  // 2. Fetch ETA Data
  // Now passing objects instead of just string IDs
  const freshEtaData = await etaFetchBatch(targetStops);

  // Save fresh results to cache
  Object.keys(freshEtaData).forEach(stopId => {
    const stopOp = targetStops.find(t => t.id === stopId)?.op;
    const grouped = etaGroupByRoute(freshEtaData[stopId], stopOp);
    grouped.forEach(r => window.etaCache.set(stopId, r.route, r));
  });

  // 3. Process and construct final presentation data
  let allCards = [];

  // Process nearby stops
  appState.nearbyStops.forEach(stop => {
    const groupedFromRaw = etaGroupByRoute(freshEtaData[stop.id] || [], stop.op);

    // Get all unique routes for this stop
    // (This list depends on your database providing a list of routes per stop)
    const routesAtStop = stop.routes || [];

    routesAtStop.forEach(routeName => {
      const isStarred = Stars.has(stop.id, routeName);
      const isNearest = stop.dist <= minDistance + CLUSTER_THRESHOLD;

      // Get data: Fresh OR Cache
      const routeData = window.etaCache.get(stop.id, routeName);

      allCards.push({
        stop: stop,
        routeData: routeData || { route: routeName, etas: [] }, // Static if no data
        isStarred: isStarred,
        isNearest: isNearest,
        hasLiveETA: !!routeData, // Use this for dimming in UI
        isTooFar: false
      });
    });
  });

  // 4. Sort Cards
  allCards.sort((a, b) => {
    // 1. Starred first
    if (a.isStarred !== b.isStarred) return b.isStarred ? 1 : -1;
    // 2. Nearest Cluster second
    if (a.isNearest !== b.isNearest) return b.isNearest ? 1 : -1;
    // 3. Absolute Distance third
    return a.stop.dist - b.stop.dist;
  });

  // 5. Group by Stop for rendering
  const structured = [];
  let currentGroup = null;

  allCards.forEach(card => {
    if (!currentGroup || currentGroup.stop.id !== card.stop.id) {
      currentGroup = {
        stop: card.stop,
        isTooFar: card.isTooFar,
        routes: []
      };
      structured.push(currentGroup);
    }
    currentGroup.routes.push(card.routeData);
  });

  uiRenderCards(structured);
}

// --- Bootstrap ---
async function initApp() {
  uiInitTheme();
  uiApplyLang();

  // Event Listeners
  document.getElementById('btnTheme').addEventListener('click', uiToggleTheme);
  document.getElementById('btnLang').addEventListener('click', uiToggleLang);

  const btnMap = document.getElementById('btnMap');
  const mapContainer = document.getElementById('map-container');
  btnMap.addEventListener('click', () => {

    if (window.map) {
        window.map._isProgrammaticMove = true;
    }

    appState.isMapMoving = true; //LOCK ON
    //1. Toggle the class(use 'collapsed' instead of 'hidden')
    const isCollapsed = mapContainer.classList.toggle('collapsed');

    //2. Clear active transitions and wait
    setTimeout(() => {
        if(typeof mapInvalidateSize === 'function') {
            mapInvalidateSize({ animate: false });
        }
        setTimeout(() => {
            appState.isMapMoving = false;
            if (window.map) {
                window.map._isProgrammaticMove = false;
            }
        }, 50);

    }, 350); //350ms so 0.3s CSS transition complete
  });

  uiShowMessage('loadingData');

  try {
    await dbEnsureData();
  } catch (err) {
    uiShowMessage('syncError');
    return;
  }

  uiShowMessage('loadingPos');
  try {
    const pos = await geoGetPosition();
    appState.centerLat = pos.lat;
    appState.centerLng = pos.lng;

    mapInit(pos.lat, pos.lng);
    await executeSearch();

    // Start Polling
    appState.intervalId = setInterval(() => {
      executeSearch(true);
    }, CONFIG.POLL_INTERVAL_MS);

  } catch (err) {
    console.warn("Geolocation failed or denied, using default HK center(Mong Kok).");
    appState.centerLat = 22.3193;
    appState.centerLng = 114.1694;
    mapInit(appState.centerLat, appState.centerLng);
    await executeSearch();
  }
}

// Start
window.addEventListener('DOMContentLoaded', initApp);
