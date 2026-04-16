let map = null;
let markers = [];
let userMarker = null;
let searchCircle = null;
let moveTimeout; // Global timer for debouncing
let currentTargetIndex = 0;

function mapInit(lat, lng) {
  if (map) return;

  const container = document.getElementById('map-container');
  if (!container) return;

  map = L.map('map-container', {
    zoomControl: false,
    attributionControl: false
  }).setView([lat, lng], 17);

  map._isProgrammaticMove = false; // Initialize the safety lock
  window.map = map;               // Export map so app.js can see window.map.getZoom()

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    minZoom: 15
  }).addTo(map);

  // Add user marker
  userMarker = L.circleMarker([lat, lng], {
    radius: 7,
    fillColor: '#4285f4',
    fillOpacity: 1,
    color: '#fff',
    weight: 2
  }).addTo(map);

  map.on('move', updateSearchCircle);
  // Event listener for map movement
  map.on('moveend', () => {
    //1. clear the timer every time the map moves
    clearTimeout(moveTimeout);

    if (!window.appState) {
        return;
    }

    //2. only trigger the search if it's not a programmatic move
    //and the map isn't mid-expansion animation
    if (typeof window.AppSetCenter === 'function' && !map._isProgrammaticMove && !window.appState.isMapMoving) {
        //3. set a 500ms delay. If the user moves again, this is canceled.
        moveTimeout = setTimeout(() => {
            const center = map.getCenter();

            //Check that location actually changed.
            if (center.lat === window.appState.centerLat &&
                center.lng === window.appState.centerLng) {
                return;
            }

            AppSetCenter(center.lat, center.lng, true);
        }, 500);
    }

    updateSearchCircle(); // Ensure circle snaps to final position

    map._isProgrammaticMove = false;
  });

  // [EXACT PLACEMENT FOR MOVE LISTENER UPDATE]
  map.on('move', updateSearchCircle); // Update circle position while dragging
  map.on('zoomend', updateSearchCircle); // Update circle size if user zooms

  // --- BUTTON LOGIC ---
  const btnRecenter = document.getElementById('btn-recenter');
    if (btnRecenter) {
      btnRecenter.addEventListener('click', async (e) => {
        e.stopPropagation();

        // 1. Safety check: Ensure db and map exist
        if (!window.db || !window.db.stops) {
            console.error("Database 'db' is not yet ready.");
            return;
        }

        const starKeys = [...Stars._set].sort();
        let targetLatLng = null;

        // 2. Increment cycle
        currentTargetIndex++;
        if (currentTargetIndex > starKeys.length) {
          currentTargetIndex = 0;
        }

        if (currentTargetIndex === 0) {
          if (userMarker) {
            targetLatLng = userMarker.getLatLng();
            btnRecenter.innerHTML = '🎯';
          }
        } else {
          const currentKey = starKeys[currentTargetIndex - 1];
          const [stopId, route] = currentKey.split(':');

          try {
            // 3. LOOKUP: Note the use of window.db
            const stopInfo = await window.db.stops.get(stopId);

            if (stopInfo && stopInfo.lat && stopInfo.lng) {
              targetLatLng = { lat: stopInfo.lat, lng: stopInfo.lng };
              btnRecenter.innerHTML = '⭐';
            } else {
              console.warn(`Stop ${stopId} data missing in DB.`);
              currentTargetIndex = 0; // Reset to GPS on failure
              if (userMarker) targetLatLng = userMarker.getLatLng();
            }
          } catch (err) {
            console.error("Database jump failed:", err);
          }
        }

        // 4. Trigger the Move
        if (targetLatLng && map) {
          map._isProgrammaticMove = true;
          map.flyTo(targetLatLng, 17, { duration: 0.8 });

          map.once('moveend', () => {
            map._isProgrammaticMove = false;
            if (typeof window.AppSetCenter === 'function') {
              window.AppSetCenter(targetLatLng.lat, targetLatLng.lng, true);
            }
            updateSearchCircle();
          });
        }
      });
    }

  // --- INITIALIZE SEARCH CIRCLE HERE ---
  updateSearchCircle();

  setTimeout(() => map.invalidateSize(), 200);
}

function updateSearchCircle() {
  if (!map) return;
  const center = map.getCenter();
  const radius = window.appState.radius || 150;

  if (!searchCircle) {
    searchCircle = L.circle(center, {
      radius: radius,
      color: '#4285f4',
      fillColor: '#4285f4',
      fillOpacity: 0.1,
      weight: 1,
      dashArray: '5, 5',
      interactive: false
    }).addTo(map);
  } else {
    searchCircle.setLatLng(center);
    searchCircle.setRadius(radius);
  }
}

function mapRefreshStops(stops) {
  if (!map || stops.length === 0) return;

  // Find the absolute minimum distance to identify the nearest cluster
  const minDistance = Math.min(...stops.map(s => s.distance));
  const CLUSTER_THRESHOLD = 5; // Meters

  // Clear existing markers
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  const theme = document.documentElement.getAttribute('data-theme') || 'light';

  // Theme colors
  const colors = {
    light: { kmb: '#cc2233', ctb: '#d4880a', nlb: '#1a6b3c' },
    dark:  { kmb: '#ff2d78', ctb: '#ff8c2a', nlb: '#39ff8e' }
  };

  stops.forEach(stop => {
    // Identify if the stop is starred or part of the nearest cluster
    const isStarredForStop = Array.from(Stars._set).some(k => k.startsWith(stop.id + ':'));
    const isNearest = (stop.distance <= minDistance + CLUSTER_THRESHOLD);
    const op = (stop.op || '').toLowerCase();
    const color = colors[theme][op] || '#888';

    const marker = L.circleMarker([stop.lat, stop.lng], {
      radius: isStarredForStop ? 6 : 4,
      fillColor: color,
      fillOpacity: isStarredForStop ? 0.9 : 0.7,
      color: isStarredForStop ? '#fff' : color,
      weight: isStarredForStop ? 2 : 1
    });

    const lang = localStorage.getItem('hkbus_lang') || 'tc';
    const name = lang === 'en' ? stop.en : stop.tc;
    marker.bindTooltip(name, { direction: 'top' });

    marker.addTo(map);

    // Apply the 'marker-active' class for the breathing effect
    // This targets markers that will have their ETA refreshed
    if (isStarredForStop || isNearest) {
      const el = marker.getElement();
      if (el) el.classList.add('marker-active');
    }

    // Add click listener to set this stop as the '0m' target
    marker.on('click', () => {
      map._isProgrammaticMove = true; // Use safety lock from original map.js
      map.flyTo([stop.lat, stop.lng], 17);
    });

    markers.push(marker);
  });
}

function mapUpdateUserPosition(lat, lng) {
  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  }
}

function mapInvalidateSize() {
  if (map) {
    setTimeout(() => map.invalidateSize(), 300);
  }
}
