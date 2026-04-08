export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only proxy the specific API route
    if (url.pathname === '/api/eta') {
      const stopId = url.searchParams.get('stop_id');
      
      // Basic validation: alphanumeric + hyphens/underscores, max 40 chars
      if (!stopId || !/^[a-zA-Z0-9_-]{1,40}$/.test(stopId)) {
        return new Response('Invalid stop_id', { status: 400 });
      }

      // Upstream KMB API (Used as the base for the proxy per spec)
      const targetUrl = `https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${stopId}`;

      const cache = caches.default;
      let response = await cache.match(request);

      if (!response) {
        response = await fetch(targetUrl);
        
        // Create a new response to modify headers for edge caching
        response = new Response(response.body, response);
        response.headers.set('Cache-Control', 'public, max-age=30, s-maxage=30');
        response.headers.set('Access-Control-Allow-Origin', '*');
        response.headers.set('X-Content-Type-Options', 'nosniff');
        
        // Put in edge cache
        ctx.waitUntil(cache.put(request, response.clone()));
      }

      return response;
    }

    // Unmatched routes fall back to static assets defined in wrangler.toml
    return new Response('Not found', { status: 404 });
  }
};