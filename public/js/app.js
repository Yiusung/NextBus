let appState = {
  centerLat: null,
  centerLng: null,
  radius: CONFIG.DEFAULT_RADIUS,
  nearbyStops: [],
  intervalId: null
};

// Global callback for UI/Map interactions
window.AppSetCenter = async function(lat, lng, isFromMapMove = false) {
  appState.centerLat = lat;
  appState.centerLng = lng;
  // If user moved map, adjust radius roughly based on zoom
  if (isFromMapMove && map) {
    const z = map.getZoom();
    if (z >= 18) appState.radius = 50;
    else if (z <= 16) appState.radius = 200;
    else appState.radius = 150;
  }
  await executeSearch();
};

window.AppRefresh = async function() {
  await executeSearch(true); // true = soft refresh (re-render with cached state + live stars)
};

async function executeSearch(isSoftRefresh = false) {
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

  // 1. Identify which routes we need ETA for.
  // We want: nearest 10 routes + ALL starred routes (regardless of distance)
  let routesToFetch = [];
  let stopMap = {}; // stopId -> list of raw route strings
  
  appState.nearbyStops.forEach(stop => {
    // Note: We don't know the exact routes at a stop until we fetch the stop ETA.
    // So we fetch ETA for the nearest N stops until we've gathered enough unique routes.
    // For simplicity in this demo, we fetch ETA for the 5 nearest stops + any stops with starred routes.
  });

  // Simplified fetch logic for the spec:
  const targetStopIds = new Set();
  
  // Add 5 nearest stops to targets
  appState.nearbyStops.slice(0, 5).forEach(s => targetStopIds.add(s.id));
  
  // Add ALL starred stops to targets (even if out of range)
  Array.from(Stars._set).forEach(key => {
    const stopId = key.split(':')[0];
    targetStopIds.add(stopId);
  });

  // 2. Fetch ETA Data
  const etaDataMap = await etaFetchBatch(Array.from(targetStopIds));

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
    mapContainer.classList.toggle('hidden');
    mapInvalidateSize();
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