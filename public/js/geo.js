function geoGetPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function geoHaversine(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function geoFormatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)}${t('meters')}`;
  }
  return `${(meters / 1000).toFixed(1)}${t('km')}`;
}

function geoEnrichAndSort(stops, centerLat, centerLng) {
  // Add distance property
  const enriched = stops.map(stop => {
    stop.dist = geoHaversine(centerLat, centerLng, stop.lat, stop.lng);
    return stop;
  });

  // Sort by distance ascending
  return enriched.sort((a, b) => a.dist - b.dist);
}