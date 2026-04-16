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

// app.js - Refined Processing Logic
async function executeSearch(isSoftRefresh = false) {
  // ... (Initial DB query and mapRefreshStops logic) ...
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

  // --- 1. Identify Target Cluster ---
  const CLUSTER_THRESHOLD = 5;
  const minDist = Math.min(...appState.nearbyStops.map(s => s.dist));
  const targetStops = [];

  appState.nearbyStops.forEach(s => {
    const isNearest = s.dist <= minDist + CLUSTER_THRESHOLD;
    const isStarred = Array.from(Stars._set).some(k => k.startsWith(s.id + ':'));
    if (isNearest || isStarred) {
      targetStops.push({ id: s.id, op: s.op });
    }
  });

  // --- 2. Fetch and Map to Cache ---
  const freshEtaData = await etaFetchBatch(targetStops);
  // (Ensure your batch fetcher saves results to window.etaCache here)

  // --- 3. Construct Cards (Revised Fix) ---
  let allCards = [];

  appState.nearbyStops.forEach(stop => {
      const freshRoutes = etaGroupByRoute(freshEtaData[stop.id] || [], stop.op);
      const starredKeys = Array.from(Stars._set).filter(k => k.startsWith(stop.id + ':'));

      // NEW: Also include known routes from the cache even if the current API call was empty
      const cachedKeys = Object.keys(window.etaCache._data).filter(k => k.startsWith(stop.id + ':'));

      const routeNames = new Set([
          ...freshRoutes.map(r => r.route),
          ...starredKeys.map(k => k.split(':')[1]),
          ...cachedKeys.map(k => k.split(':')[1]) // Ensures the CTB route persists
      ]);

      routeNames.forEach(routeName => {
          const routeData = freshRoutes.find(r => r.route === routeName) || window.etaCache.get(stop.id, routeName);

          allCards.push({
              stop: stop,
              routeData: routeData || { route: routeName, etas: [], rmk: "Out of Service" }, // Fallback text
              isStarred: Stars.has(stop.id, routeName),
              isNearest: stop.dist <= minDist + 5,
              hasLiveETA: !!(freshRoutes.find(r => r.route === routeName)),
              isTooFar: false
          });
      });
  });

  // --- 4. Sorting & Structuring ---
  allCards.sort((a, b) => {
    if (a.isStarred !== b.isStarred) return b.isStarred ? -1 : 1;
    if (a.isNearest !== b.isNearest) return a.isNearest ? -1 : 1;
    return a.stop.dist - b.stop.dist;
  });

  // Rebuild the structured group for uiRenderCards
  const structured = [];
  let currentGroup = null;

  allCards.forEach(card => {
    if (!currentGroup || currentGroup.stop.id !== card.stop.id) {
      currentGroup = {
        stop: card.stop,
        isTooFar: card.isTooFar,
        routes: [] // This will store the route objects for uiRenderCards
      };
      structured.push(currentGroup);
    }
    // Push the enriched route object
    currentGroup.routes.push({
      routeData: card.routeData,
      isStarred: card.isStarred,
      isNearest: card.isNearest,
      hasLiveETA: card.hasLiveETA
    });
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
