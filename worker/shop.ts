/**
 * Eigen webshop (CONCEPT): bestellen, betalen via Mollie, verzendlabels via MyParcel.
 *
 * Klantkant (achter het beheerwachtwoord zolang het een concept is):
 *   /shop-concept/                 winkel + winkelmand (statische Astro-pagina)
 *   /shop-concept/afrekenen/       afrekenformulier (statisch)
 *   /shop-concept/bedankt/         bedankpagina, haalt de status op
 *   /shop-concept/api/producten    actuele producten en prijzen (uit de database)
 *   /shop-concept/api/bestel       maakt een bestelling + Mollie-betaling
 *   /shop-concept/api/status       status van één bestelling (met geheim token)
 *   /shop-concept/testbetaling     nep-betaalpagina zolang er geen Mollie-sleutel is
 * Openbaar (Mollie moet erbij kunnen):
 *   /api/mollie/webhook            Mollie meldt een statuswijziging; wij halen de echte status op
 * Beheer (wachtwoord):
 *   /beheer/bestellingen[/id]      overzicht, label maken, trackingcode, verzonden
 *   /beheer/producten              prijzen en verzendkosten
 *
 * Bedragen staan in centen, inclusief btw. Prijzen worden ALTIJD op de server
 * uit de database berekend, nooit uit wat de browser stuurt.
 */

interface D1Result<T> { results: T[] }
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  run(): Promise<{ meta?: { last_row_id?: number } }>;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
}
export interface ShopEnv {
  DB?: { prepare(sql: string): D1Stmt; batch?(s: D1Stmt[]): Promise<unknown> };
  ADMIN_PASSWORD?: string;
  MOLLIE_API_KEY?: string;      // test_... of live_...
  MYPARCEL_API_KEY?: string;
  MOLLIE_BASE_URL?: string;    // alleen voor lokale tests
  MYPARCEL_BASE_URL?: string;  // alleen voor lokale tests
  CHAT_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

type Product = {
  sku: string; naam: string; lijn: string; vorm: string; prijs_cent: number | null;
  actief: number; volgorde: number; afbeelding: string | null;
};
type Regel = { sku: string; naam: string; vorm: string; aantal: number; prijs_cent: number };
type Bestelling = {
  id: number; nr: string; token: string; created_at: string; status: string; betaalstatus: string | null;
  naam: string; email: string; telefoon: string | null; straat: string; huisnummer: string; toevoeging: string | null;
  postcode: string; plaats: string; land: string; opmerking: string | null; regels: string;
  subtotaal_cent: number; verzend_cent: number; totaal_cent: number;
  mollie_id: string | null; testbetaling: number; betaald_at: string | null;
  myparcel_id: number | null; barcode: string | null; track_url: string | null; verzonden_at: string | null; notitie: string | null;
};

export const SHOP_BASE = '/shop-concept';
const STATUSSEN = ['open', 'betaald', 'verzonden', 'geannuleerd', 'mislukt'] as const;
const LANDEN: Record<string, string> = { NL: 'Nederland', BE: 'België' };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
export const euro = (cent: number | null | undefined) =>
  cent === null || cent === undefined ? '–' : '€ ' + (cent / 100).toFixed(2).replace('.', ',');
const mollieBedrag = (cent: number) => (cent / 100).toFixed(2);

function randomToken(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
}
function sameOrigin(request: Request, url: URL) {
  const o = request.headers.get('origin');
  return !o || new URL(o).host === url.host;
}

async function instelling(env: ShopEnv, sleutel: string): Promise<string | null> {
  const r = await env.DB!.prepare('SELECT waarde FROM instellingen WHERE sleutel = ?').bind(sleutel).first<{ waarde: string }>();
  return r?.waarde ?? null;
}
async function verzendkosten(env: ShopEnv, subtotaal: number): Promise<number> {
  const basis = Number(await instelling(env, 'verzendkosten_cent')) || 0;
  const gratis = Number(await instelling(env, 'gratis_verzending_vanaf_cent')) || 0;
  return gratis > 0 && subtotaal >= gratis ? 0 : basis;
}

/* ------------------------------------------------------------------ */
/* Klantkant                                                           */
/* ------------------------------------------------------------------ */

export async function handleShopApi(request: Request, env: ShopEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'no_db' }, 503);
  const pad = url.pathname.slice(SHOP_BASE.length);

  if (pad === '/api/producten') {
    const { results } = await env.DB.prepare('SELECT sku, naam, lijn, vorm, prijs_cent, afbeelding FROM producten WHERE actief = 1 ORDER BY volgorde').all<Product>();
    return json({
      producten: results,
      verzendkosten_cent: Number(await instelling(env, 'verzendkosten_cent')) || 0,
      gratis_vanaf_cent: Number(await instelling(env, 'gratis_verzending_vanaf_cent')) || 0,
      testmodus: !env.MOLLIE_API_KEY || env.MOLLIE_API_KEY.startsWith('test_'),
    });
  }

  if (pad === '/api/bestel') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
    if (env.CHAT_LIMITER) {
      const ip = request.headers.get('cf-connecting-ip') ?? 'onbekend';
      const { success } = await env.CHAT_LIMITER.limit({ key: `bestel:${ip}` });
      if (!success) return json({ error: 'rate_limited' }, 429);
    }
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad_json' }, 400); }
    return bestel(body, env, url);
  }

  if (pad === '/api/status') {
    const nr = url.searchParams.get('o') ?? '';
    const token = url.searchParams.get('t') ?? '';
    let b = await env.DB.prepare('SELECT * FROM bestellingen WHERE nr = ?').bind(nr).first<Bestelling>();
    if (!b || b.token !== token) return json({ error: 'not_found' }, 404);
    // Webhook nog niet binnen? Dan zelf de status bij Mollie navragen.
    if (b.status === 'open' && b.mollie_id && env.MOLLIE_API_KEY) {
      await syncMollie(env, b.mollie_id);
      b = (await env.DB.prepare('SELECT * FROM bestellingen WHERE id = ?').bind(b.id).first<Bestelling>())!;
    }
    return json({
      nr: b.nr, status: b.status, naam: b.naam, email: b.email,
      regels: JSON.parse(b.regels), subtotaal_cent: b.subtotaal_cent, verzend_cent: b.verzend_cent, totaal_cent: b.totaal_cent,
      track_url: b.track_url, barcode: b.barcode,
    });
  }

  if (pad === '/api/herroep/zoek' || pad === '/api/herroep/bevestig') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
    if (env.CHAT_LIMITER) {
      const ip = request.headers.get('cf-connecting-ip') ?? 'onbekend';
      const { success } = await env.CHAT_LIMITER.limit({ key: `herroep:${ip}` });
      if (!success) return json({ error: 'rate_limited' }, 429);
    }
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad_json' }, 400); }
    return herroep(pad.endsWith('/bevestig'), body, env);
  }

  if (pad === '/testbetaling') return testbetaling(request, env, url);
  return json({ error: 'not_found' }, 404);
}

async function bestel(body: Record<string, unknown>, env: ShopEnv, url: URL): Promise<Response> {
  const k = (body.klant ?? {}) as Record<string, unknown>;
  const klant = {
    naam: clean(k.naam, 80), email: clean(k.email, 120).toLowerCase(), telefoon: clean(k.telefoon, 30),
    straat: clean(k.straat, 100), huisnummer: clean(k.huisnummer, 10), toevoeging: clean(k.toevoeging, 10),
    postcode: clean(k.postcode, 10).toUpperCase().replace(/\s+/g, ''), plaats: clean(k.plaats, 60),
    land: clean(k.land, 2).toUpperCase() || 'NL', opmerking: clean(k.opmerking, 500),
  };
  const fouten: string[] = [];
  if (klant.naam.length < 2) fouten.push('naam');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(klant.email)) fouten.push('email');
  if (klant.straat.length < 2) fouten.push('straat');
  if (!/^\d{1,5}$/.test(klant.huisnummer)) fouten.push('huisnummer');
  if (!LANDEN[klant.land]) fouten.push('land');
  if (klant.land === 'NL' && !/^[1-9]\d{3}[A-Z]{2}$/.test(klant.postcode)) fouten.push('postcode');
  if (klant.land === 'BE' && !/^\d{4}$/.test(klant.postcode)) fouten.push('postcode');
  if (klant.plaats.length < 2) fouten.push('plaats');
  if (body.akkoord !== true) fouten.push('akkoord');

  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  const { results: producten } = await env.DB!.prepare('SELECT * FROM producten WHERE actief = 1').all<Product>();
  const regels: Regel[] = [];
  for (const it of items as { sku?: unknown; aantal?: unknown }[]) {
    const p = producten.find((x) => x.sku === it?.sku);
    const aantal = Math.floor(Number(it?.aantal));
    if (!p || p.prijs_cent === null || !(aantal >= 1 && aantal <= 20)) continue;
    const bestaand = regels.find((r) => r.sku === p.sku);
    if (bestaand) bestaand.aantal = Math.min(20, bestaand.aantal + aantal);
    else regels.push({ sku: p.sku, naam: p.naam, vorm: p.vorm, aantal, prijs_cent: p.prijs_cent });
  }
  if (!regels.length) fouten.push('winkelmand');
  if (fouten.length) return json({ error: 'invalid', velden: fouten }, 400);

  const subtotaal = regels.reduce((s, r) => s + r.aantal * r.prijs_cent, 0);
  const verzend = await verzendkosten(env, subtotaal);
  const totaal = subtotaal + verzend;
  const token = randomToken();

  const res = await env.DB!.prepare(
    `INSERT INTO bestellingen (token, naam, email, telefoon, straat, huisnummer, toevoeging, postcode, plaats, land, opmerking,
      regels, subtotaal_cent, verzend_cent, totaal_cent, testbetaling)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(token, klant.naam, klant.email, klant.telefoon || null, klant.straat, klant.huisnummer, klant.toevoeging || null,
    klant.postcode, klant.plaats, klant.land, klant.opmerking || null, JSON.stringify(regels), subtotaal, verzend, totaal,
    env.MOLLIE_API_KEY ? 0 : 1).run();
  const id = res.meta?.last_row_id!;
  const nr = 'DM' + String(10000 + id);
  await env.DB!.prepare('UPDATE bestellingen SET nr = ? WHERE id = ?').bind(nr, id).run();

  const bedankt = new URL(`${SHOP_BASE}/bedankt/?o=${nr}&t=${token}`, url).toString();

  if (!env.MOLLIE_API_KEY) {
    // Nog geen Mollie-sleutel: nep-betaalpagina, zodat je de hele flow kunt testen.
    return json({ nr, redirect: new URL(`${SHOP_BASE}/testbetaling?o=${nr}&t=${token}`, url).toString() });
  }

  const r = await fetch(`${env.MOLLIE_BASE_URL ?? 'https://api.mollie.com'}/v2/payments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.MOLLIE_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      amount: { currency: 'EUR', value: mollieBedrag(totaal) },
      description: `Bestelling ${nr} Darmmanagement`,
      redirectUrl: bedankt,
      webhookUrl: new URL('/api/mollie/webhook', url).toString(),
      locale: klant.land === 'BE' ? 'nl_BE' : 'nl_NL',
      metadata: { bestelling: nr },
    }),
  });
  const p = (await r.json().catch(() => ({}))) as { id?: string; _links?: { checkout?: { href?: string } }; detail?: string };
  if (!r.ok || !p.id || !p._links?.checkout?.href) {
    await env.DB!.prepare("UPDATE bestellingen SET status = 'mislukt', notitie = ? WHERE id = ?").bind(`Mollie-fout: ${p.detail ?? r.status}`, id).run();
    return json({ error: 'payment_failed' }, 502);
  }
  await env.DB!.prepare('UPDATE bestellingen SET mollie_id = ?, betaalstatus = ? WHERE id = ?').bind(p.id, 'open', id).run();
  return json({ nr, redirect: p._links.checkout.href });
}

/** Mollie roept dit aan met alleen een betaling-id; de echte status halen we zelf op (niet te vervalsen). */
export async function handleMollieWebhook(request: Request, env: ShopEnv): Promise<Response> {
  if (request.method !== 'POST' || !env.DB || !env.MOLLIE_API_KEY) return new Response('ok');
  const form = await request.formData().catch(() => null);
  const id = String(form?.get('id') ?? '');
  if (/^tr_[A-Za-z0-9]+$/.test(id)) await syncMollie(env, id);
  return new Response('ok'); // altijd 200, anders blijft Mollie het opnieuw proberen
}

async function syncMollie(env: ShopEnv, mollieId: string) {
  const r = await fetch(`${env.MOLLIE_BASE_URL ?? 'https://api.mollie.com'}/v2/payments/${mollieId}`, { headers: { authorization: `Bearer ${env.MOLLIE_API_KEY}` } });
  if (!r.ok) return;
  const p = (await r.json()) as { status?: string; paidAt?: string };
  const st = p.status ?? '';
  const b = await env.DB!.prepare('SELECT id, status FROM bestellingen WHERE mollie_id = ?').bind(mollieId).first<{ id: number; status: string }>();
  if (!b) return;
  let nieuw = b.status;
  if (st === 'paid' && b.status === 'open') nieuw = 'betaald';
  if (['failed', 'canceled', 'expired'].includes(st) && b.status === 'open') nieuw = 'mislukt';
  await env.DB!.prepare('UPDATE bestellingen SET betaalstatus = ?, status = ?, betaald_at = COALESCE(betaald_at, ?) WHERE id = ?')
    .bind(st, nieuw, st === 'paid' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, b.id).run();
}

/** Moment in Nederlandse tijd, voor de klant. */
export const nlTijd = (utc: string) =>
  new Date(utc.replace(' ', 'T') + 'Z').toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'long', timeStyle: 'short' });

/**
 * Herroepingsfunctie ("Koop ongedaan maken"): stap 1 zoekt de bestelling met bestelnummer + e-mail,
 * stap 2 legt de herroeping vast met datum en tijd. Geen account nodig.
 * We laten herroepen toe tot 60 dagen na bestellen; de wettelijke termijn (14 dagen na ontvangst)
 * beoordeel je in het beheer.
 */
async function herroep(bevestig: boolean, body: Record<string, unknown>, env: ShopEnv): Promise<Response> {
  const nr = clean(body.nr, 20).toUpperCase().replace(/\s+/g, '');
  const email = clean(body.email, 120).toLowerCase();
  const b = await env.DB!.prepare(
    "SELECT * FROM bestellingen WHERE nr = ? AND lower(email) = ? AND status IN ('betaald','verzonden') AND created_at >= datetime('now','-60 days')",
  ).bind(nr, email).first<Bestelling>();
  if (!b) return json({ error: 'not_found' }, 404);
  const regels = JSON.parse(b.regels) as Regel[];
  const { results: eerder } = await env.DB!.prepare('SELECT created_at, regels FROM herroepingen WHERE bestelling_id = ? ORDER BY id').bind(b.id).all<{ created_at: string; regels: string }>();
  // Wat is al herroepen? Dat kan niet nog eens.
  const al: Record<string, number> = {};
  for (const h of eerder) for (const r of JSON.parse(h.regels) as Regel[]) al[r.sku] = (al[r.sku] ?? 0) + r.aantal;
  const over = regels.map((r) => ({ sku: r.sku, naam: r.naam, vorm: r.vorm, aantal: Math.max(0, r.aantal - (al[r.sku] ?? 0)) }));

  if (!bevestig) {
    return json({ nr: b.nr, regels: over, eerder: eerder.map((h) => nlTijd(h.created_at)) });
  }
  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  const gekozen: { sku: string; naam: string; vorm: string; aantal: number }[] = [];
  for (const it of items as { sku?: unknown; aantal?: unknown }[]) {
    const r = over.find((x) => x.sku === it?.sku);
    const n = Math.floor(Number(it?.aantal));
    if (r && n >= 1 && n <= r.aantal) gekozen.push({ ...r, aantal: n });
  }
  if (!gekozen.length) return json({ error: 'niets_gekozen' }, 400);
  const geheel = over.every((r) => (gekozen.find((g) => g.sku === r.sku)?.aantal ?? 0) === r.aantal) ? 1 : 0;
  const res = await env.DB!.prepare('INSERT INTO herroepingen (bestelling_id, regels, geheel) VALUES (?, ?, ?)')
    .bind(b.id, JSON.stringify(gekozen), geheel).run();
  const h = await env.DB!.prepare('SELECT created_at FROM herroepingen WHERE id = ?').bind(res.meta?.last_row_id).first<{ created_at: string }>();
  return json({ nr: b.nr, moment: nlTijd(h!.created_at), regels: gekozen, geheel: !!geheel });
}

/** Alleen zonder Mollie-sleutel: een nagebootste betaalpagina om de flow te testen. */
async function testbetaling(request: Request, env: ShopEnv, url: URL): Promise<Response> {
  if (env.MOLLIE_API_KEY) return new Response('Niet beschikbaar', { status: 404 });
  const nr = url.searchParams.get('o') ?? '';
  const token = url.searchParams.get('t') ?? '';
  const b = await env.DB!.prepare('SELECT * FROM bestellingen WHERE nr = ?').bind(nr).first<Bestelling>();
  if (!b || b.token !== token) return new Response('Onbekende bestelling', { status: 404 });
  if (request.method === 'POST') {
    if (!sameOrigin(request, url)) return new Response('Niet toegestaan', { status: 403 });
    const form = await request.formData();
    const ok = form.get('uitkomst') === 'betaald';
    if (b.status === 'open') {
      await env.DB!.prepare('UPDATE bestellingen SET status = ?, betaalstatus = ?, betaald_at = ? WHERE id = ?')
        .bind(ok ? 'betaald' : 'mislukt', ok ? 'paid' : 'canceled', ok ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, b.id).run();
    }
    return Response.redirect(new URL(`${SHOP_BASE}/bedankt/?o=${nr}&t=${token}`, url).toString(), 303);
  }
  return adminPage(`<h2>Testbetaling (nagebootst)</h2>
<p>Er is nog geen Mollie-sleutel ingesteld. Op deze pagina doe je alsof je betaalt, zodat je de hele bestelling kunt testen. Met een Mollie-testsleutel zie je hier de echte Mollie-testpagina.</p>
<p><strong>Bestelling ${esc(b.nr)}</strong> · ${euro(b.totaal_cent)}</p>
<form method="post"><input type="hidden" name="uitkomst" value="betaald"><button class="prim">Betaling geslaagd</button></form>
<form method="post"><input type="hidden" name="uitkomst" value="mislukt"><button class="danger">Betaling mislukt</button></form>`, 'Testbetaling', false);
}

/* ------------------------------------------------------------------ */
/* Beheer                                                              */
/* ------------------------------------------------------------------ */

export function adminPage(body: string, titel = 'Bestellingen', metNav = true, status = 200) {
  return new Response(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Beheer · ${esc(titel)}</title><style>
body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f6f4ee;color:#1f2a24}
header{background:#1f4d3a;color:#fff;padding:12px 20px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}header h1{font-size:1.1rem;margin:0 12px 0 0}
header a{color:#dfeee5;text-decoration:none}header a.on{color:#fff;font-weight:700;text-decoration:underline}
main{max-width:1080px;margin:0 auto;padding:18px}
h2{margin:.2em 0 .6em}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dde3dc;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #eceae2;vertical-align:top;font-size:.93rem}th{background:#eef2ec;font-weight:600}
tr:last-child td{border-bottom:0}a{color:#1f4d3a}
.pill{display:inline-block;padding:.1em .6em;border-radius:999px;font-size:.8rem;font-weight:600;background:#eee}
.pill.open{background:#fff4cc;color:#6b5300}.pill.betaald{background:#dff0e4;color:#1f6a3d}.pill.verzonden{background:#dde9f7;color:#1f4f8a}
.pill.geannuleerd,.pill.mislukt{background:#f6e0da;color:#8a3420}.pill.test{background:#efe6fb;color:#5a3a8a}
.tabs a{margin-right:12px}.tabs a.on{font-weight:700}
.card{background:#fff;border:1px solid #dde3dc;border-radius:12px;padding:14px 16px;margin:12px 0}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 14px;margin:.2em 0}dt{color:#5d6b63}dd{margin:0}
.meta{color:#5d6b63;font-size:.88rem}.warn{background:#fff4cc;color:#6b5300;padding:.5em .8em;border-radius:8px}
.ok{background:#dff0e4;color:#1f6a3d;padding:.5em .8em;border-radius:8px}.err{background:#f6e0da;color:#8a3420;padding:.5em .8em;border-radius:8px}
form{display:inline}form.block{display:block;margin:.5em 0}
input,select{font:inherit;padding:.35em .5em;border:1px solid #c9d1c8;border-radius:8px}input.prijs{width:7em}
button{font:inherit;padding:.4em .9em;border-radius:999px;border:1.5px solid #1f4d3a;background:#fff;color:#1f4d3a;cursor:pointer;margin:4px 6px 0 0}
button.prim{background:#1f4d3a;color:#fff}button.danger{border-color:#b04a2f;color:#b04a2f}
</style></head><body><header><h1>Darmmanagement · beheer</h1>${metNav ? `
<a href="/beheer/bestellingen" class="${titel === 'Bestellingen' ? 'on' : ''}">Bestellingen</a>
<a href="/beheer/producten" class="${titel === 'Producten' ? 'on' : ''}">Producten en prijzen</a>
<a href="/beheer">Ervaringen</a>
<a href="${SHOP_BASE}/" target="_blank" rel="noopener">Winkel (concept) ↗</a>` : ''}</header><main>${body}</main></body></html>`, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

/** Aangeroepen vanuit handleBeheer, ná de wachtwoordcontrole. */
export async function handleShopBeheer(request: Request, env: ShopEnv, url: URL): Promise<Response> {
  if (!env.DB) return adminPage('<p>Geen database gekoppeld.</p>', 'Bestellingen', true, 503);
  if (request.method === 'POST' && !sameOrigin(request, url)) return adminPage('<p>Niet toegestaan.</p>', 'Bestellingen', true, 403);
  const p = url.pathname;
  if (p === '/beheer/producten') return producten(request, env, url);
  const m = p.match(/^\/beheer\/bestellingen\/(\d+)(\/[a-z-]+(?:\.pdf)?)?$/);
  if (m) return bestellingDetail(request, env, url, Number(m[1]), m[2] ?? '');
  return bestellingenLijst(env, url);
}

async function bestellingenLijst(env: ShopEnv, url: URL) {
  const filter = url.searchParams.get('status') ?? 'te-verzenden';
  const { results } = await env.DB!.prepare('SELECT * FROM bestellingen ORDER BY id DESC LIMIT 500').all<Bestelling>();
  const { results: hr } = await env.DB!.prepare("SELECT DISTINCT bestelling_id FROM herroepingen WHERE status = 'ontvangen'").all<{ bestelling_id: number }>();
  const herroepen = new Set(hr.map((h) => h.bestelling_id));
  const tabs: [string, string, (b: Bestelling) => boolean][] = [
    ['herroepen', 'Koop ongedaan gemaakt', (b) => herroepen.has(b.id)],
    ['te-verzenden', 'Te verzenden', (b) => b.status === 'betaald'],
    ['verzonden', 'Verzonden', (b) => b.status === 'verzonden'],
    ['open', 'Wacht op betaling', (b) => b.status === 'open'],
    ['alle', 'Alle', () => true],
  ];
  const actief = tabs.find((t) => t[0] === filter) ?? tabs[1];
  const lijst = results.filter(actief[2]);
  const nav = `<p class="tabs">${tabs.map(([k, l, f]) => `<a href="?status=${k}" class="${k === actief[0] ? 'on' : ''}">${l} (${results.filter(f).length})</a>`).join('')}</p>`;
  const rijen = lijst.map((b) => {
    const regels = (JSON.parse(b.regels) as Regel[]).map((r) => `${r.aantal}× ${esc(r.naam.replace('Darmmanagement ', ''))} ${esc(r.vorm.replace(/ \(.*\)/, ''))}`).join('<br>');
    return `<tr><td><a href="/beheer/bestellingen/${b.id}"><strong>${esc(b.nr)}</strong></a><br><span class="meta">${esc(b.created_at.slice(0, 16))}</span></td>
<td>${esc(b.naam)}<br><span class="meta">${esc(b.postcode)} ${esc(b.plaats)}</span></td><td>${regels}</td><td>${euro(b.totaal_cent)}</td>
<td><span class="pill ${esc(b.status)}">${esc(b.status)}</span>${b.testbetaling ? ' <span class="pill test">test</span>' : ''}${herroepen.has(b.id) ? ' <span class="pill mislukt">herroepen</span>' : ''}${b.barcode ? `<br><span class="meta">${esc(b.barcode)}</span>` : ''}</td></tr>`;
  }).join('');
  return adminPage(`<h2>Bestellingen</h2>${nav}
${lijst.length ? `<table><tr><th>Bestelling</th><th>Klant</th><th>Producten</th><th>Totaal</th><th>Status</th></tr>${rijen}</table>` : '<p>Geen bestellingen in deze lijst.</p>'}`);
}

function trackUrl(barcode: string, postcode: string, land: string) {
  return `https://jouw.postnl.nl/track-and-trace/${encodeURIComponent(barcode)}-${encodeURIComponent(land)}-${encodeURIComponent(postcode)}`;
}

async function myparcel(env: ShopEnv, pad: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('authorization', 'basic ' + btoa(env.MYPARCEL_API_KEY!));
  headers.set('user-agent', 'DarmmanagementShop/1.0');
  return fetch(`${env.MYPARCEL_BASE_URL ?? 'https://api.myparcel.nl'}${pad}`, { ...init, headers });
}

async function bestellingDetail(request: Request, env: ShopEnv, url: URL, id: number, actie: string): Promise<Response> {
  const b = await env.DB!.prepare('SELECT * FROM bestellingen WHERE id = ?').bind(id).first<Bestelling>();
  if (!b) return adminPage('<p>Bestelling niet gevonden.</p>', 'Bestellingen', true, 404);
  const terug = (msg?: string) => Response.redirect(new URL(`/beheer/bestellingen/${id}${msg ? `?m=${encodeURIComponent(msg)}` : ''}`, url).toString(), 303);

  if (actie === '/label.pdf') {
    if (!env.MYPARCEL_API_KEY || !b.myparcel_id) return adminPage('<p>Er is nog geen label.</p>', 'Bestellingen', true, 404);
    const formaat = url.searchParams.get('formaat') === 'A4' ? 'A4' : 'A6';
    const r = await myparcel(env, `/shipment_labels/${b.myparcel_id}?format=${formaat}&positions=1`, { headers: { accept: 'application/pdf' } });
    if (!r.ok) return adminPage(`<p class="err">MyParcel gaf een fout (${r.status}) bij het ophalen van het label.</p>`, 'Bestellingen', true, 502);
    // Na het aanmaken van het label kent MyParcel de barcode: meteen opslaan.
    if (!b.barcode) await haalBarcode(env, b);
    return new Response(r.body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="label-${b.nr}.pdf"`, 'cache-control': 'no-store' } });
  }

  if (request.method === 'POST') {
    const form = await request.formData();
    if (actie === '/label') {
      if (!env.MYPARCEL_API_KEY) return terug('Er is nog geen MyParcel-sleutel ingesteld.');
      if (b.myparcel_id) return terug('Er is al een zending aangemaakt.');
      const pakket = form.get('pakket') === '2' ? 2 : 1; // 1 = pakket, 2 = brievenbuspakje
      const r = await myparcel(env, '/shipments', {
        method: 'POST',
        headers: { 'content-type': 'application/vnd.shipment+json;version=1.1;charset=utf-8' },
        body: JSON.stringify({ data: { shipments: [{
          carrier: 1, // PostNL
          reference_identifier: b.nr,
          recipient: {
            cc: b.land, postal_code: b.postcode, city: b.plaats, street: b.straat, number: b.huisnummer,
            number_suffix: b.toevoeging ?? '', person: b.naam, email: b.email, phone: b.telefoon ?? '',
          },
          options: { package_type: pakket, label_description: b.nr },
        }] } }),
      });
      const d = (await r.json().catch(() => ({}))) as { data?: { ids?: { id: number }[] }; message?: string; errors?: unknown };
      const mpId = d.data?.ids?.[0]?.id;
      if (!r.ok || !mpId) return terug(`MyParcel gaf een fout: ${d.message ?? JSON.stringify(d.errors ?? r.status).slice(0, 200)}`);
      await env.DB!.prepare('UPDATE bestellingen SET myparcel_id = ? WHERE id = ?').bind(mpId, id).run();
      return terug('Zending aangemaakt bij MyParcel. Download nu het label; daarna verschijnt de trackingcode.');
    }
    if (actie === '/tracking') {
      const barcode = clean(form.get('barcode'), 40).toUpperCase().replace(/\s+/g, '');
      const eigen = clean(form.get('track_url'), 300);
      if (barcode && !/^[A-Z0-9]{8,40}$/.test(barcode)) return terug('Dat lijkt geen geldige trackingcode.');
      const link = eigen && /^https:\/\//.test(eigen) ? eigen : barcode ? trackUrl(barcode, b.postcode, b.land) : null;
      await env.DB!.prepare('UPDATE bestellingen SET barcode = ?, track_url = ? WHERE id = ?').bind(barcode || null, link, id).run();
      return terug('Trackingcode opgeslagen.');
    }
    if (actie === '/verzonden') {
      if (b.status !== 'betaald') return terug('Alleen betaalde bestellingen kunnen op verzonden.');
      if (!b.barcode && env.MYPARCEL_API_KEY && b.myparcel_id) await haalBarcode(env, b);
      await env.DB!.prepare("UPDATE bestellingen SET status = 'verzonden', verzonden_at = datetime('now') WHERE id = ?").bind(id).run();
      return terug('Gemarkeerd als verzonden.');
    }
    if (actie === '/status') {
      const s = String(form.get('status'));
      if (!STATUSSEN.includes(s as never)) return terug('Ongeldige status.');
      await env.DB!.prepare('UPDATE bestellingen SET status = ? WHERE id = ?').bind(s, id).run();
      return terug(`Status gewijzigd naar ${s}.`);
    }
    if (actie === '/herroep-af') {
      const hid = Number(form.get('hid'));
      await env.DB!.prepare("UPDATE herroepingen SET status = 'afgehandeld', afgehandeld_at = datetime('now') WHERE id = ? AND bestelling_id = ?").bind(hid, id).run();
      return terug('Herroeping gemarkeerd als afgehandeld.');
    }
    if (actie === '/notitie') {
      await env.DB!.prepare('UPDATE bestellingen SET notitie = ? WHERE id = ?').bind(clean(form.get('notitie'), 1000) || null, id).run();
      return terug('Notitie opgeslagen.');
    }
    return terug();
  }

  const regels = JSON.parse(b.regels) as Regel[];
  const msg = url.searchParams.get('m');
  const { results: hlijst } = await env.DB!.prepare('SELECT * FROM herroepingen WHERE bestelling_id = ? ORDER BY id').bind(id).all<{ id: number; created_at: string; regels: string; geheel: number; status: string; afgehandeld_at: string | null }>();
  const herroepSectie = hlijst.length ? `<section class="card" style="border-left:5px solid #b04a2f"><h3>Koop ongedaan gemaakt door de klant</h3>
${hlijst.map((h) => `<p><strong>${esc(nlTijd(h.created_at))}</strong> · ${h.geheel ? 'hele bestelling' : 'deel van de bestelling'} · <span class="pill ${h.status === 'afgehandeld' ? 'betaald' : 'mislukt'}">${esc(h.status)}</span><br>
${(JSON.parse(h.regels) as Regel[]).map((r) => `${r.aantal}× ${esc(r.naam)} – ${esc(r.vorm)}`).join('<br>')}</p>
${h.status === 'ontvangen' ? `<form method="post" action="/beheer/bestellingen/${id}/herroep-af" class="block"><input type="hidden" name="hid" value="${h.id}"><button class="prim">Afgehandeld (terugbetaald)</button></form>` : `<p class="meta">Afgehandeld: ${esc(h.afgehandeld_at)} UTC</p>`}`).join('')}
<p class="meta">Wettelijk: terugbetalen binnen 14 dagen na de herroeping, inclusief de standaard verzendkosten bij herroeping van de hele bestelling. Je mag wachten tot het product terug is of de klant aantoont dat het is teruggestuurd. Terugbetalen doe je in het Mollie-dashboard.</p></section>` : '';
  const adres = `${esc(b.straat)} ${esc(b.huisnummer)}${b.toevoeging ? ' ' + esc(b.toevoeging) : ''}<br>${esc(b.postcode)} ${esc(b.plaats)}<br>${esc(LANDEN[b.land] ?? b.land)}`;
  const mpUit = !env.MYPARCEL_API_KEY;

  let verzending: string;
  if (b.myparcel_id) {
    verzending = `<p>Zending bij MyParcel: <strong>#${b.myparcel_id}</strong></p>
<p><a href="/beheer/bestellingen/${id}/label.pdf" target="_blank"><button class="prim" type="button">Label downloaden (A6)</button></a>
<a href="/beheer/bestellingen/${id}/label.pdf?formaat=A4" target="_blank"><button type="button">Label op A4</button></a></p>`;
  } else if (b.status === 'betaald') {
    verzending = `<form method="post" action="/beheer/bestellingen/${id}/label" class="block">
<label>Soort: <select name="pakket"><option value="1">Pakket</option><option value="2">Brievenbuspakje</option></select></label>
<button class="prim" ${mpUit ? 'disabled' : ''}>Verzendlabel maken (MyParcel)</button></form>
${mpUit ? '<p class="warn">Nog geen MyParcel-sleutel ingesteld. Vul de trackingcode dan hieronder zelf in.</p>' : '<p class="meta">Het label wordt aangemaakt bij MyParcel (PostNL). Kosten volgens je MyParcel-tarief.</p>'}`;
  } else {
    verzending = '<p class="meta">Een label maak je zodra de bestelling betaald is.</p>';
  }

  return adminPage(`<p><a href="/beheer/bestellingen">← Alle bestellingen</a></p>
<h2>Bestelling ${esc(b.nr)} <span class="pill ${esc(b.status)}">${esc(b.status)}</span>${b.testbetaling ? ' <span class="pill test">testbetaling</span>' : ''}</h2>
${msg ? `<p class="${/fout|geen|ongeldig|alleen/i.test(msg) ? 'err' : 'ok'}">${esc(msg)}</p>` : ''}
<div class="grid">
<section class="card"><h3>Klant</h3><dl><dt>Naam</dt><dd>${esc(b.naam)}</dd><dt>E-mail</dt><dd><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></dd>
${b.telefoon ? `<dt>Telefoon</dt><dd>${esc(b.telefoon)}</dd>` : ''}<dt>Adres</dt><dd>${adres}</dd>
${b.opmerking ? `<dt>Opmerking</dt><dd>${esc(b.opmerking)}</dd>` : ''}</dl></section>
<section class="card"><h3>Producten</h3><table>${regels.map((r) => `<tr><td>${r.aantal}×</td><td>${esc(r.naam)}<br><span class="meta">${esc(r.vorm)}</span></td><td>${euro(r.aantal * r.prijs_cent)}</td></tr>`).join('')}
<tr><td></td><td>Verzendkosten</td><td>${euro(b.verzend_cent)}</td></tr><tr><td></td><td><strong>Totaal (incl. btw)</strong></td><td><strong>${euro(b.totaal_cent)}</strong></td></tr></table>
<p class="meta">Besteld: ${esc(b.created_at)} UTC${b.betaald_at ? ` · betaald: ${esc(b.betaald_at)} UTC` : ''}${b.mollie_id ? ` · Mollie: ${esc(b.mollie_id)}` : ''}</p></section>
</div>
${herroepSectie}
<section class="card"><h3>Verzenden</h3>${verzending}
<form method="post" action="/beheer/bestellingen/${id}/tracking" class="block">
<label>Trackingcode: <input name="barcode" value="${esc(b.barcode ?? '')}" placeholder="3SXXXX1234567" size="20"></label>
<label>of eigen trackinglink: <input name="track_url" value="${esc(b.track_url && !b.track_url.includes('jouw.postnl.nl') ? b.track_url : '')}" placeholder="https://..." size="28"></label>
<button>Opslaan</button></form>
${b.track_url ? `<p>Volglink voor de klant: <a href="${esc(b.track_url)}" target="_blank" rel="noopener">${esc(b.track_url)}</a></p>` : ''}
${b.status === 'betaald' ? `<form method="post" action="/beheer/bestellingen/${id}/verzonden" class="block"><button class="prim">Markeer als verzonden</button></form>
<p class="meta">Concept: de klant krijgt nog geen automatische e-mail. Dat komt zodra het domein gekoppeld is.</p>` : ''}
${b.verzonden_at ? `<p class="meta">Verzonden: ${esc(b.verzonden_at)} UTC</p>` : ''}</section>
<section class="card"><h3>Notitie (alleen intern)</h3><form method="post" action="/beheer/bestellingen/${id}/notitie" class="block">
<input name="notitie" value="${esc(b.notitie ?? '')}" size="60"><button>Opslaan</button></form>
<form method="post" action="/beheer/bestellingen/${id}/status" class="block"><label>Status handmatig: <select name="status">${STATUSSEN.map((s) => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label> <button>Wijzigen</button></form>
<p class="meta">Terugbetalen doe je in het Mollie-dashboard.</p></section>`);
}

async function haalBarcode(env: ShopEnv, b: Bestelling) {
  const r = await myparcel(env, `/shipments/${b.myparcel_id}`, { headers: { accept: 'application/json' } });
  if (!r.ok) return;
  const d = (await r.json().catch(() => ({}))) as { data?: { shipments?: { barcode?: string }[] } };
  const barcode = d.data?.shipments?.[0]?.barcode;
  if (barcode) {
    await env.DB!.prepare('UPDATE bestellingen SET barcode = ?, track_url = ? WHERE id = ?')
      .bind(barcode, trackUrl(barcode, b.postcode, b.land), b.id).run();
  }
}

async function producten(request: Request, env: ShopEnv, url: URL): Promise<Response> {
  if (request.method === 'POST') {
    const form = await request.formData();
    const { results } = await env.DB!.prepare('SELECT sku FROM producten').all<{ sku: string }>();
    const naarCent = (v: FormDataEntryValue | null) => {
      const s = String(v ?? '').trim().replace(/[€\s]/g, '').replace(',', '.');
      if (!s) return null;
      const n = Math.round(Number(s) * 100);
      return Number.isFinite(n) && n >= 0 && n < 100000 ? n : undefined;
    };
    for (const { sku } of results) {
      const prijs = naarCent(form.get(`prijs_${sku}`));
      if (prijs === undefined) return Response.redirect(new URL(`/beheer/producten?m=${encodeURIComponent(`Ongeldige prijs bij ${sku}`)}`, url).toString(), 303);
      await env.DB!.prepare('UPDATE producten SET prijs_cent = ?, actief = ? WHERE sku = ?').bind(prijs, form.get(`actief_${sku}`) ? 1 : 0, sku).run();
    }
    const vk = naarCent(form.get('verzendkosten'));
    const gratis = naarCent(form.get('gratis_vanaf'));
    if (vk === undefined || gratis === undefined) return Response.redirect(new URL('/beheer/producten?m=Ongeldige%20verzendkosten', url).toString(), 303);
    await env.DB!.prepare('INSERT OR REPLACE INTO instellingen (sleutel, waarde) VALUES (?, ?)').bind('verzendkosten_cent', String(vk ?? 0)).run();
    await env.DB!.prepare('INSERT OR REPLACE INTO instellingen (sleutel, waarde) VALUES (?, ?)').bind('gratis_verzending_vanaf_cent', gratis === null ? '' : String(gratis)).run();
    return Response.redirect(new URL('/beheer/producten?m=Opgeslagen', url).toString(), 303);
  }
  const { results } = await env.DB!.prepare('SELECT * FROM producten ORDER BY volgorde').all<Product>();
  const vk = Number(await instelling(env, 'verzendkosten_cent')) || 0;
  const gratis = Number(await instelling(env, 'gratis_verzending_vanaf_cent')) || 0;
  const v = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));
  const msg = url.searchParams.get('m');
  return adminPage(`<h2>Producten en prijzen</h2>
${msg ? `<p class="${msg === 'Opgeslagen' ? 'ok' : 'err'}">${esc(msg)}</p>` : ''}
<p class="warn">Voorlopige prijzen, afgeleid van de prijsklassen op powerdetox.nl. Controleer ze. Een product zonder prijs is niet te bestellen.</p>
<form method="post" class="block"><table><tr><th>Product</th><th>Verpakking</th><th>Prijs incl. btw (€)</th><th>Te koop</th></tr>
${results.map((p) => `<tr><td>${esc(p.naam)}</td><td>${esc(p.vorm)}</td><td><input class="prijs" name="prijs_${esc(p.sku)}" value="${v(p.prijs_cent)}" inputmode="decimal" placeholder="geen prijs"></td>
<td><input type="checkbox" name="actief_${esc(p.sku)}" ${p.actief ? 'checked' : ''}></td></tr>`).join('')}</table>
<p><label>Verzendkosten per bestelling (€): <input class="prijs" name="verzendkosten" value="${v(vk)}" inputmode="decimal"></label>
<label style="margin-left:16px">Gratis verzending vanaf (€, leeg = nooit): <input class="prijs" name="gratis_vanaf" value="${gratis ? v(gratis) : ''}" inputmode="decimal"></label></p>
<button class="prim">Opslaan</button></form>
<p class="meta">Koppelingen: Mollie ${env.MOLLIE_API_KEY ? (env.MOLLIE_API_KEY.startsWith('test_') ? '<strong>testmodus</strong>' : '<strong>live</strong>') : '<strong>niet ingesteld</strong> (nagebootste betaling)'} · MyParcel ${env.MYPARCEL_API_KEY ? '<strong>ingesteld</strong>' : '<strong>niet ingesteld</strong>'}</p>`, 'Producten');
}
