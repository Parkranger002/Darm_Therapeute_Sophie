// @ts-check
import { defineConfig } from 'astro/config';

// Stap A is volledig statisch: Astro bouwt naar ./dist en Cloudflare Workers
// serveert die map als static assets (zie wrangler.jsonc).
// Voor stap B (echte AI-chat) voeg je de @astrojs/cloudflare-adapter toe
// en een serverroute, zie README.md.
export default defineConfig({
  output: 'static',
});
