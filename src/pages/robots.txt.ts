import type { APIRoute } from 'astro';

// Zoekmachines mogen alles lezen behalve de beheerpagina en de API.
export const GET: APIRoute = ({ site }) =>
  new Response(
    ['User-agent: *', 'Allow: /', 'Disallow: /beheer', 'Disallow: /api/', '', `Sitemap: ${new URL('/sitemap.xml', site)}`, ''].join('\n'),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
