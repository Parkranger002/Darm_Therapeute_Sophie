/**
 * Cloudflare Worker voor de Darmmanagement-begeleider.
 *
 * - /api/chat  → beantwoordt chatberichten met Claude (Anthropic API)
 * - /api/ervaring → slaat een ingevulde ervaring op (D1-database)
 * - /beheer    → beveiligde pagina om ervaringen te lezen (wachtwoord)
 * - al het andere → de statische Astro-site uit ./dist (ASSETS)
 *
 * Chatgesprekken worden niet opgeslagen. Alleen ingevulde ervaringen worden bewaard.
 */
import instructies from '../src/knowledge/instructies.md';
import product from '../src/knowledge/product.md';
import aandoeningen from '../src/knowledge/aandoeningen.md';
import { checkAlarm, filterOutput, ALARM_REPLIES } from '../src/lib/safety';
import { handleErvaring, handleBeheer, type ErvaringEnv } from './ervaringen';

interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

interface Env extends ErvaringEnv {
  ASSETS: { fetch(req: Request): Promise<Response> };
  ANTHROPIC_API_KEY?: string;
  MODEL?: string;
  ANTHROPIC_BASE_URL?: string; // alleen voor lokale tests
  CHAT_LIMITER?: RateLimiter;
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Sites waarop de begeleider mag zoeken. */
const ALLOWED_DOMAINS = [
  'thuisarts.nl',
  'voedingscentrum.nl',
  'rivm.nl',
  'mlds.nl',
  'crohn-colitis.nl',
  'darmmanagement.nl',
  'powerdetox.nl',
];

const MAX_MESSAGES = 14; // laatste berichten die we meesturen
const MAX_USER_CHARS = 1000;
const MAX_ASSISTANT_CHARS = 4000;

const SYSTEM_KNOWLEDGE = [
  instructies,
  '# Productinformatie',
  product,
  '# Kennisbank',
  aandoeningen,
].join('\n\n');

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return handleChat(request, env, url);
    }
    if (url.pathname === '/api/ervaring') return handleErvaring(request, env, url);
    if (url.pathname === '/beheer' || url.pathname.startsWith('/beheer/')) return handleBeheer(request, env, url);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};

async function handleChat(request: Request, env: Env, url: URL): Promise<Response> {
  // Alleen verzoeken vanaf de eigen site.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ error: 'forbidden' }, 403);

  const len = Number(request.headers.get('content-length') || '0');
  if (len > 40_000) return json({ error: 'too_large' }, 413);

  // Misbruik beperken: max. aantal berichten per IP-adres per minuut (niet opgeslagen).
  if (env.CHAT_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') || 'onbekend';
    const { success } = await env.CHAT_LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'rate_limited' }, 429);
  }

  let messages: ChatMessage[];
  try {
    const body = (await request.json()) as { messages?: unknown };
    messages = validate(body.messages);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const last = messages[messages.length - 1];

  // 1. Alarmsignalen: vast antwoord, zonder AI.
  const alarm = checkAlarm(last.content);
  if (alarm) return json({ reply: ALARM_REPLIES[alarm].join('\n\n'), sources: [], safety: true });

  if (!env.ANTHROPIC_API_KEY) return json({ error: 'not_configured' }, 503);

  // Eerder in het gesprek een alarmsignaal? Dan geen productinformatie meer.
  const earlierAlarm = messages.some((m) => m.role === 'user' && checkAlarm(m.content));

  const system: Array<Record<string, unknown>> = [
    { type: 'text', text: SYSTEM_KNOWLEDGE, cache_control: { type: 'ephemeral' } },
  ];
  if (earlierAlarm) {
    system.push({
      type: 'text',
      text: 'Let op: in dit gesprek heeft de bezoeker eerder een alarmsignaal genoemd. Geef in dit gesprek geen productinformatie meer en verwijs bij klachten naar de huisarts.',
    });
  }

  // 2. Claude aanroepen (met zoeken op vaste sites).
  let result: { text: string; sources: Array<{ title: string; url: string }> };
  try {
    result = await askClaude(env, system, messages);
  } catch (err) {
    console.error('anthropic_error', (err as Error).message); // geen gespreksinhoud loggen
    return json({ error: 'upstream' }, 502);
  }

  // 3. Uitvoerfilter.
  const filtered = filterOutput(result.text);
  return json({
    reply: filtered.text,
    sources: filtered.replaced ? [] : result.sources,
    safety: earlierAlarm,
  });
}

function validate(input: unknown): ChatMessage[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('empty');
  const msgs: ChatMessage[] = input.map((m) => {
    const role = (m as ChatMessage)?.role;
    const content = (m as ChatMessage)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') throw new Error('shape');
    const max = role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
    const text = content.trim().slice(0, max);
    if (!text) throw new Error('empty message');
    return { role, content: text };
  });
  // Laatste berichten, beginnend met een gebruikersbericht, eindigend met een gebruikersbericht.
  let recent = msgs.slice(-MAX_MESSAGES);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  if (!recent.length || recent[recent.length - 1].role !== 'user') throw new Error('last not user');
  // Opeenvolgende berichten van dezelfde rol samenvoegen (API-vereiste).
  const merged: ChatMessage[] = [];
  for (const m of recent) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content += '\n\n' + m.content;
    else merged.push({ ...m });
  }
  return merged;
}

async function askClaude(env: Env, system: Array<Record<string, unknown>>, messages: ChatMessage[]) {
  const base = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const convo: Array<{ role: string; content: unknown }> = messages.map((m) => ({ role: m.role, content: m.content }));
  const texts: string[] = [];
  const sources = new Map<string, string>();

  // Bij een lange zoekactie kan de API pauzeren ("pause_turn"); dan gaan we verder.
  for (let round = 0; round < 3; round++) {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.MODEL || 'claude-sonnet-5-5',
        max_tokens: 700,
        system,
        messages: convo,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 2,
            allowed_domains: ALLOWED_DOMAINS,
          },
        ],
      }),
      signal: AbortSignal.timeout(28_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string; citations?: Array<{ type: string; url?: string; title?: string | null }> }>;
      stop_reason: string;
    };

    for (const block of data.content) {
      if (block.type !== 'text' || !block.text) continue;
      texts.push(block.text);
      for (const c of block.citations ?? []) {
        if (c.type === 'web_search_result_location' && c.url?.startsWith('https://') && !sources.has(c.url)) {
          sources.set(c.url, c.title || new URL(c.url).hostname);
        }
      }
    }

    if (data.stop_reason !== 'pause_turn') break;
    convo.push({ role: 'assistant', content: data.content });
  }

  const text = texts.join('').trim();
  if (!text) throw new Error('empty reply');
  return { text, sources: [...sources].slice(0, 4).map(([url, title]) => ({ url, title })) };
}
