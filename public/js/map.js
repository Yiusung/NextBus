let map = null;
let markers = [];
let userMarker = null;

function mapInit(lat, lng) {
  if (map) return;

  const container = document.getElementById('map-container');
  if (!container) return;

  map = L.map('map-container', {
    zoomControl: false,
    attributionControl: false
  }).setView([lat, lng], 17);

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

  // Event listener for map movement
  map.on('moveend', () => {
    const center = map.getCenter();
    // Prevent triggering if app.js is programmatically setting center
    if (typeof AppSetCenter === 'function' && !map._isProgrammaticMove) {
      AppSetCenter(center.lat, center.lng, true); 
    }
    map._isProgrammaticMove = false;
  });
}

function mapRefreshStops(stops) {
  if (!map) return;

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
    const isStarredForStop = Array.from(Stars._set).some(k => k.startsWith(stop.id + ':'));
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