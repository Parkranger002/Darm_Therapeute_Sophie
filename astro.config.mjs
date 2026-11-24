// @ts-check
import { defineConfig } from 'astro/config';

// Stap A is volledig statisch: Astro bouwt naar ./dist en Cloudflare Workers
// serveert die map als static assets (zie wrangler.jsonc).
// Voor stap B (echte AI-chat) voeg je de @astrojs/cloudflare-adapter toe
// en een serverroute, zie README.md.
// Het officiële adres van de site, voor canonical-tags, de sitemap en delen-links.
// Staat de site later op een eigen domein, pas dan alleen deze regel aan.
export const SITE = 'https://darmmanagement-begeleider.spring-wind-f0ee.workers.dev';

export default defineConfig({
  output: 'static',
  site: SITE,
});
