async function etaFetchOne(stopId) {
  try {
    const res = await fetch(`/api/eta?stop_id=${stopId}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.data || [];
  } catch {
    return [];
  }
}

async function etaFetchBatch(stopIds) {
  const uniqueIds = [...new Set(stopIds)];
  const promises = uniqueIds.map(id => etaFetchOne(id).then(data => ({ id, data })));
  const results = await Promise.allSettled(promises);
  
  const map = {};
  results.forEach(r => {
    if (r.status === 'fulfilled') {
      map[r.value.id] = r.value.data;
    }
  });
  return map;
}

function etaClass(minutes) {
  if (minutes === null || minutes === undefined) return 'na';
  if (minutes <= 2) return 'hot';
  if (minutes <= 8) return 'warm';
  return 'cool';
}

function etaGroupByRoute(etaDataArray, stopOp) {
  const routes = {};
  
  // Filter out past ETAs and data not matching the stop's primary operator
  const validData = etaDataArray.filter(eta => {
    if (eta.eta == null) return false;
    // Only show ETA for the specific operator of this physical stop
    return (eta.co || '').toLowerCase() === (stopOp || '').toLowerCase();
  });

  validData.forEach(eta => {
    const route = eta.route;
    if (!routes[route]) {
      routes[route] = {
        route: route,
        dest: { tc: eta.dest_tc, en: eta.dest_en },
        co: eta.co,
        times: []
      };
    }
    
    // Calculate minutes from now
    const etaTime = new Date(eta.eta).getTime();
    const now = Date.now();
    const diffMins = Math.max(0, Math.floor((etaTime - now) / 60000));
    
    routes[route].times.push(diffMins);
  });

  // Sort times and limit to 3 chips
  Object.values(routes).forEach(r => {
    r.times.sort((a, b) => a - b);
    r.times = r.times.slice(0, 3);
  });

  return Object.values(routes);
}