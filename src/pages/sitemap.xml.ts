import type { APIRoute } from 'astro';

// Alle openbare pagina's, met hoe belangrijk ze zijn voor de vindbaarheid.
const PAGES: [path: string, priority: string][] = [
  ['/', '1.0'],
  ['/start-een-gesprek/', '0.9'],
  ['/product/', '0.9'],
  ['/vezelcheck/', '0.9'],
  ['/veelgestelde-vragen/', '0.8'],
  ['/ervaringen/', '0.7'],
  ['/over-ons/', '0.6'],
  ['/medische-informatie/', '0.4'],
  ['/contact/', '0.4'],
  ['/privacy/', '0.2'],
];

export const GET: APIRoute = ({ site }) => {
  const today = new Date().toISOString().slice(0, 10);
  const urls = PAGES.map(
    ([p, prio]) => `  <url><loc>${new URL(p, site)}</loc><lastmod>${today}</lastmod><priority>${prio}</priority></url>`,
  ).join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'content-type': 'application/xml; charset=utf-8' } },
  );
};
