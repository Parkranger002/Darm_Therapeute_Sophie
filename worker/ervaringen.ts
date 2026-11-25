/**
 * Ervaringen van gebruikers: opslaan (/api/ervaring) en lezen op de
 * beveiligde beheerpagina (/beheer, met wachtwoord).
 */
import { validate, letOp, type Ervaring } from '../src/lib/ervaring';

interface D1Result<T> { results: T[] }
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  run(): Promise<unknown>;
  all<T>(): Promise<D1Result<T>>;
}
export interface ErvaringEnv {
  DB?: { prepare(sql: string): D1Stmt };
  ADMIN_PASSWORD?: string;
  CHAT_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

type Row = Ervaring & { id: number; created_at: string; let_op: string; status: string };

const STATUSES = ['nieuw', 'goedgekeurd', 'afgewezen'] as const;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : undefined;

export async function handleErvaring(request: Request, env: ErvaringEnv, url: URL): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ error: 'forbidden' }, 403);
  if (Number(request.headers.get('content-length') ?? 0) > 8000) return json({ error: 'too_large' }, 413);
  if (env.CHAT_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'onbekend';
    const { success } = await env.CHAT_LIMITER.limit({ key: `ervaring:${ip}` });
    if (!success) return json({ error: 'rate_limited' }, 429);
  }
  if (!env.DB) return json({ error: 'not_configured' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad_request', message: 'Ongeldig verzoek.' }, 400);
  }
  // Honeypot: een verborgen veld dat alleen spambots invullen.
  if (body.website) return json({ ok: true });

  const e: Partial<Ervaring> = {
    product: clean(body.product, 40),
    vorm: clean(body.vorm, 40) || undefined,
    duur: clean(body.duur, 40),
    porties: clean(body.porties, 40) || undefined,
    mengen: clean(body.mengen, 40) || undefined,
    nog_in_gebruik: clean(body.nog_in_gebruik, 10),
    aanbevolen: clean(body.aanbevolen, 60) || undefined,
    tevredenheid: typeof body.tevredenheid === 'number' ? body.tevredenheid : undefined,
    verhaal: clean(body.verhaal, 1000) || undefined,
    plaatsen: clean(body.plaatsen, 60),
    voornaam: clean(body.voornaam, 40) || undefined,
    email: clean(body.email, 120) || undefined,
  };
  const error = validate(e);
  if (error) return json({ error: 'invalid', message: error }, 400);

  await env.DB.prepare(
    `INSERT INTO ervaringen (product, vorm, duur, porties, mengen, nog_in_gebruik, aanbevolen, tevredenheid, verhaal, plaatsen, voornaam, email, let_op)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(e.product, e.vorm ?? null, e.duur, e.porties ?? null, e.mengen ?? null, e.nog_in_gebruik, e.aanbevolen ?? null,
      e.tevredenheid ?? null, e.verhaal ?? null, e.plaatsen, e.voornaam ?? null, e.email ?? null, letOp(e.verhaal ?? ''))
    .run();
  return json({ ok: true });
}

/**
 * Openbare lijst: alleen goedgekeurde ervaringen met toestemming om te plaatsen.
 * Nooit het e-mailadres; de voornaam alleen als de schrijver daarvoor koos.
 */
export async function handleErvaringenLijst(request: Request, env: ErvaringEnv): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  if (!env.DB) return json({ ervaringen: [] });
  const { results } = await env.DB.prepare(
    `SELECT product, vorm, duur, aanbevolen, tevredenheid, verhaal, plaatsen, voornaam, created_at
     FROM ervaringen WHERE status = 'goedgekeurd' AND plaatsen LIKE 'Ja%' ORDER BY id DESC LIMIT 200`,
  ).all<Row>();
  const ervaringen = results.map((r) => ({
    naam: r.plaatsen === 'Ja, met mijn voornaam' && r.voornaam ? r.voornaam : null,
    product: r.product,
    vorm: r.vorm ?? null,
    duur: r.duur,
    aanbevolen: r.aanbevolen === 'Ja',
    tevredenheid: r.tevredenheid ?? null,
    verhaal: r.verhaal ?? null,
    maand: String(r.created_at).slice(0, 7),
  }));
  return new Response(JSON.stringify({ ervaringen }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}

// ── Beheerpagina ─────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function authorized(request: Request, env: ErvaringEnv): boolean {
  if (!env.ADMIN_PASSWORD) return false;
  const h = request.headers.get('authorization') ?? '';
  if (!h.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = atob(h.slice(6)); } catch { return false; }
  const i = decoded.indexOf(':');
  const user = decoded.slice(0, i);
  const pass = decoded.slice(i + 1);
  return timingSafeEqual(user, 'beheer') && timingSafeEqual(pass, env.ADMIN_PASSWORD);
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const page = (body: string, status = 200) =>
  new Response(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Beheer · ervaringen</title><style>
body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f6f4ee;color:#1f2a24}
header{background:#1f4d3a;color:#fff;padding:14px 20px}header h1{font-size:1.15rem;margin:0}
main{max-width:980px;margin:0 auto;padding:18px}
nav a{margin-right:12px;color:#1f4d3a}nav a.on{font-weight:700}
.card{background:#fff;border:1px solid #dde3dc;border-radius:12px;padding:14px 16px;margin:12px 0}
.card.goedgekeurd{border-left:5px solid #2f7d55}.card.afgewezen{border-left:5px solid #b04a2f;opacity:.75}.card.nieuw{border-left:5px solid #c9a227}
.meta{color:#5d6b63;font-size:.88rem}.verhaal{white-space:pre-line;margin:.6em 0;background:#f6f4ee;padding:.6em .8em;border-radius:8px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 14px;margin:.4em 0;font-size:.92rem}dt{color:#5d6b63}dd{margin:0}
.letop{background:#fde9e1;color:#7a2e18;padding:.3em .6em;border-radius:6px;font-size:.88rem;display:inline-block}
form{display:inline}button{font:inherit;padding:.35em .8em;border-radius:999px;border:1.5px solid #1f4d3a;background:#fff;color:#1f4d3a;cursor:pointer;margin:4px 6px 0 0}
button.danger{border-color:#b04a2f;color:#b04a2f}.top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
</style></head><body><header><h1>Darmmanagement · ervaringen van gebruikers</h1></header><main>${body}</main></body></html>`, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    },
  });

export async function handleBeheer(request: Request, env: ErvaringEnv, url: URL): Promise<Response> {
  if (!env.ADMIN_PASSWORD) return page('<p>De beheerpagina is nog niet ingesteld (geen wachtwoord).</p>', 503);
  if (!authorized(request, env)) {
    // Afremmen van wachtwoord-raden: hooguit 12 mislukte pogingen per minuut per IP-adres.
    if (env.CHAT_LIMITER) {
      const ip = request.headers.get('cf-connecting-ip') ?? 'onbekend';
      const { success } = await env.CHAT_LIMITER.limit({ key: `beheer:${ip}` });
      if (!success) return new Response('Te veel pogingen. Probeer het over een minuut opnieuw.', { status: 429 });
    }
    return new Response('Inloggen vereist', {
      status: 401,
      headers: { 'www-authenticate': 'Basic realm="Darmmanagement beheer", charset="UTF-8"', 'cache-control': 'no-store' },
    });
  }
  if (!env.DB) return page('<p>Geen database gekoppeld.</p>', 503);

  if (request.method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) return page('<p>Niet toegestaan.</p>', 403);
    const form = await request.formData();
    const id = Number(form.get('id'));
    if (!Number.isInteger(id)) return page('<p>Ongeldig verzoek.</p>', 400);
    if (url.pathname === '/beheer/status') {
      const status = String(form.get('status'));
      if (!STATUSES.includes(status as never)) return page('<p>Ongeldige status.</p>', 400);
      await env.DB.prepare('UPDATE ervaringen SET status = ? WHERE id = ?').bind(status, id).run();
    } else if (url.pathname === '/beheer/verwijder') {
      await env.DB.prepare('DELETE FROM ervaringen WHERE id = ?').bind(id).run();
    }
    return Response.redirect(new URL('/beheer' + (form.get('terug') ? `?status=${encodeURIComponent(String(form.get('terug')))}` : ''), url).toString(), 303);
  }

  const { results } = await env.DB.prepare('SELECT * FROM ervaringen ORDER BY id DESC LIMIT 1000').all<Row>();

  if (url.pathname === '/beheer/export.csv') {
    const cols = ['id', 'created_at', 'status', 'product', 'vorm', 'duur', 'porties', 'mengen', 'nog_in_gebruik', 'aanbevolen', 'tevredenheid', 'plaatsen', 'voornaam', 'email', 'let_op', 'verhaal'];
    const cell = (v: unknown) => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = "'" + s; // geen formules in Excel
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = '﻿' + [cols.join(';'), ...results.map((r) => cols.map((c) => cell((r as Record<string, unknown>)[c])).join(';'))].join('\r\n');
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="ervaringen.csv"',
        'cache-control': 'no-store',
      },
    });
  }

  const filter = url.searchParams.get('status');
  const list = STATUSES.includes(filter as never) ? results.filter((r) => r.status === filter) : results;
  const count = (s: string) => results.filter((r) => r.status === s).length;
  const nav = `<nav><a href="/beheer" class="${!filter ? 'on' : ''}">Alle (${results.length})</a>${STATUSES.map(
    (s) => `<a href="/beheer?status=${s}" class="${filter === s ? 'on' : ''}">${s} (${count(s)})</a>`,
  ).join('')}</nav>`;

  const cards = list.map((r) => {
    const field = (label: string, v: unknown) => (v === null || v === undefined || v === '' ? '' : `<dt>${label}</dt><dd>${esc(v)}</dd>`);
    const btn = (s: string, label: string) =>
      r.status === s ? '' : `<form method="post" action="/beheer/status"><input type="hidden" name="id" value="${r.id}"><input type="hidden" name="status" value="${s}"><input type="hidden" name="terug" value="${esc(filter ?? '')}"><button>${label}</button></form>`;
    return `<article class="card ${esc(r.status)}">
<div class="top"><strong>#${r.id} · ${esc(r.voornaam || 'zonder naam')}</strong><span class="meta">${esc(r.created_at)} UTC · status: ${esc(r.status)}</span></div>
${r.let_op ? `<p class="letop">Let op, mogelijk medische claim: ${esc(r.let_op)}</p>` : ''}
${r.verhaal ? `<div class="verhaal">${esc(r.verhaal)}</div>` : ''}
<dl>${field('Product', r.product)}${field('Vorm', r.vorm)}${field('Gebruikt', r.duur)}${field('Per dag', r.porties)}${field('Gemengd door', r.mengen)}${field('Nog in gebruik', r.nog_in_gebruik)}${field('Aanbevolen', r.aanbevolen)}${field('Tevredenheid', r.tevredenheid ? `${r.tevredenheid} van 5` : '')}${field('Op de website', r.plaatsen)}${field('E-mail', r.email)}</dl>
${btn('goedgekeurd', 'Goedkeuren')}${btn('afgewezen', 'Afwijzen')}${btn('nieuw', 'Terug naar nieuw')}
<form method="post" action="/beheer/verwijder"><input type="hidden" name="id" value="${r.id}"><input type="hidden" name="terug" value="${esc(filter ?? '')}"><button class="danger">Verwijderen</button></form>
</article>`;
  }).join('');

  return page(`<div class="top">${nav}<a href="/beheer/export.csv">Download als Excel (CSV)</a></div>
<p class="meta">Plaats alleen ervaringen met toestemming ("Op de website: ja") en zonder medische claims. "Verwijderen" wist een ervaring definitief.</p>
${cards || '<p>Nog geen ervaringen.</p>'}`);
}
