window.appState = {
  centerLat: null,
  centerLng: null,
  radius: CONFIG.DEFAULT_RADIUS,
  nearbyStops: [],
  intervalId: null,
  isMapMoving: false
};

// Global callback for UI/Map interactions
window.AppSetCenter = async function(lat, lng, isFromMapMove = false) {
  if (window.appState.isMapMoving) return;

  window.appState.centerLat = lat;
  window.appState.centerLng = lng;
  // If user moved map, adjust radius roughly based on zoom
  if (isFromMapMove && window.map) {
    const z = window.map.getZoom();
    if (z >= 18) window.appState.radius = 50;
    else if (z <= 16) window.appState.radius = 200;
    else window.appState.radius = 150;
  }
  await executeSearch();
};

window.AppRefresh = async function() {
  await executeSearch(true); // true = soft refresh (re-render with cached state + live stars)
};

async function executeSearch(isSoftRefresh = false) {
  //If map is moving, skip this update cycle
  if (appState.isMapMoving) return;

  if (!appState.centerLat || !appState.centerLng) return;

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

  // Add 5 nearest stops (we push the whole object so eta.js knows the operator)
  appState.nearbyStops.slice(0, 5).forEach(s => {
    targetStops.push({ id: s.id, op: s.op });
  });

  // Add ALL starred stops to targets (even if out of range)
  // We must fetch them from IndexedDB to get their operator code.
  for (const key of Array.from(Stars._set)) {
    const stopId = key.split(':')[0];

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
  const etaDataMap = await etaFetchBatch(targetStops);

  // 3. Process and construct final presentation data
  let allCards = [];

  // Process nearby stops
  appState.nearbyStops.forEach(stop => {
    const rawEta = etaDataMap[stop.id] || [];
    const groupedRoutes = etaGroupByRoute(rawEta, stop.op);

    groupedRoutes.forEach(r => {
      allCards.push({
        stop: stop,
        routeData: r,
        isStarred: Stars.has(stop.id, r.route),
        isTooFar: false // Within radius
      });
    });
  });

  // Process starred routes that are OUTSIDE the nearby stops array
  Array.from(Stars._set).forEach(async key => {
    const [stopId, route] = key.split(':');
    const isAlreadyIncluded = allCards.some(c => c.stop.id === stopId && c.routeData.route === route);

    if (!isAlreadyIncluded) {
      // Fetch full stop info from DB since it wasn't in the BBox
      const stopRecord = await db.stops.get(stopId);
      if (stopRecord) {
        const rawEta = etaDataMap[stopId] || [];
        const groupedRoutes = etaGroupByRoute(rawEta, stopRecord.op);
        const specificRoute = groupedRoutes.find(r => r.route === route);

        if (specificRoute) {
          // Calculate distance from current center
          stopRecord.dist = geoHaversine(appState.centerLat, appState.centerLng, stopRecord.lat, stopRecord.lng);
          allCards.push({
            stop: stopRecord,
            routeData: specificRoute,
            isStarred: true,
            isTooFar: true // Outside radius, but starred
          });
        }
      }
    }
  });

  // 4. Sort Cards
  allCards.sort((a, b) => {
    if (a.isStarred !== b.isStarred) return b.isStarred ? 1 : -1; // Starred first
    if (a.stop.dist !== b.stop.dist) return a.stop.dist - b.stop.dist; // Nearest stop first
    // Route alphanumeric
    return a.routeData.route.localeCompare(b.routeData.route, undefined, { numeric: true });
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
    appState.isMapMoving = true; //LOCK ON
    //1. Toggle the class(use 'collapsed' instead of 'hidden')
    const isCollapsed = mapContainer.classList.toggle('collapsed');

    //2. Clear active transitions and wait
    setTimeout(() => {
        if(typeof mapInvalidateSize === 'function') {
            mapInvalidateSize({ animate: false });
        }
        appState.isMapMoving = false; //LOCK OFF
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
    console.warn("Geolocation failed or denied, using default HK center.");
    appState.centerLat = 22.3193;
    appState.centerLng = 114.1694;
    mapInit(appState.centerLat, appState.centerLng);
    await executeSearch();
  }
}

// Start
window.addEventListener('DOMContentLoaded', initApp);
