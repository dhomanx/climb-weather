// Cloudflare Worker — CORS proxy for Met Éireann XML endpoints
// Deploy with: wrangler deploy
// Only needed if direct browser fetch to met.ie is blocked by CORS.

const ALLOWED_ORIGINS = [
  'https://www.met.ie',
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    if (!target) {
      return new Response('Missing ?url= parameter', { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    // Restrict to allowed origins
    if (!ALLOWED_ORIGINS.some(o => targetUrl.origin === o)) {
      return new Response('Forbidden origin', { status: 403 });
    }

    const upstream = await fetch(targetUrl.toString(), {
      headers: { 'User-Agent': 'IrishClimbingWeather/1.0 CORS-Proxy' },
    });

    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'text/xml',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=1200', // 20 min
      },
    });
  },
};
