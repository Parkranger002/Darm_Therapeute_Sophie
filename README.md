# Darmmanagement-begeleider: stap A (klikbaar prototype)

Een Astro-site met de startpagina en een chatvenster met **vaste voorbeeldantwoorden**.
Er draait nog geen AI, er zijn geen accounts en er wordt niets opgeslagen of verstuurd.

## Lokaal draaien

```bash
npm install
npm run dev          # http://localhost:4321
```

## Online zetten op Cloudflare

De site is volledig statisch. Cloudflare Workers serveert de map `dist/` als static assets (zie `wrangler.jsonc`).

**Optie 1: vanaf je computer**

```bash
npx wrangler login   # eenmalig, opent je browser
npm run deploy       # bouwt en zet online op darmmanagement-begeleider.<jouw-account>.workers.dev
```

**Optie 2: automatisch vanuit GitHub**
Zet de code in een GitHub-repo. Ga in het Cloudflare-dashboard naar *Workers & Pages → Create → Import a repository*.
Build command: `npm run build`, deploy command: `npx wrangler deploy`. Elke push zet dan een nieuwe versie online.

Een eigen domein (bijv. `begeleider.darmmanagement.nl`) koppel je daarna bij de Worker onder *Settings → Domains & Routes*.

## Waar staat wat?

| Bestand | Inhoud |
|---|---|
| `src/pages/index.astro` | Startpagina |
| `src/components/Chat.astro` | Chatvenster (opmaak en gedrag) |
| `src/lib/flow.ts` | **Alle teksten, vragen, knoppen en veiligheidsregels** van het gesprek |
| `src/pages/*.astro` | Over ons, product, privacy, medische informatie, contact (met `[In te vullen]`-plekken) |
| `src/styles/global.css` | Kleuren en lettertypes |

Teksten aanpassen doe je vrijwel altijd in `src/lib/flow.ts`.

## Wat het prototype al doet

- Starten via de knop, een onderwerp, of meteen zelf typen.
- Eén vraag tegelijk: wat merk je, hoelang, alarmsignalen, frequentie, Bristol-keuzekaart, doel.
- **Veiligheid voorop:** woorden als *bloed*, *hevige pijn*, *koorts* sturen altijd naar de veiligheidsroute,
  ook midden in een vraag. Daarna wordt er in dat gesprek geen productinformatie meer gegeven.
- Product alleen na toestemming. Ingrediënten en instructies worden niet verzonnen: de begeleider zegt
  dat de gecontroleerde bron nog niet gekoppeld is.
- Een samenvatting met alleen wat de gebruiker zelf heeft verteld.

> ⚠️ De alarmsignalen en verwijsregels in `flow.ts` zijn **voorbeelden**. Laat ze vóór echt gebruik
> opstellen en toetsen door een bevoegde zorgprofessional.

## Testen met bezoekers (doel van stap A)

- Begrijpen ze meteen wat ze kunnen vragen?
- Beginnen ze liever met een knop of met een eigen vraag?
- Is duidelijk dat ze met AI praten?
- Voelt de toon prettig en niet te commercieel?

## Volgende stap B: een echte AI-chat

1. `npx astro add cloudflare` (voegt de `@astrojs/cloudflare`-adapter toe).
2. Maak `src/pages/api/chat.ts` met `export const prerender = false;`. Die route ontvangt berichten
   en roept het AI-model aan.
3. Zet de API-sleutel als geheim op de server: `npx wrangler secret put AI_API_KEY`. Nooit in de browser.
4. Draai de alarmsignaal-check **op de server, vóór** de AI-aanroep, zodat de veiligheidsroute niet van het model afhangt.
5. Geef het model alleen productinformatie uit een gecontroleerde bron (bijv. een vast JSON-bestand of Cloudflare D1).
6. Bescherm de route tegen misbruik: Cloudflare Turnstile en een rate limit.
7. Vervang in `Chat.astro` de aanroep van `interpret()` door een `fetch('/api/chat')`.
8. Werk de privacypagina bij: gezondheidsgegevens zijn bijzondere persoonsgegevens onder de AVG,
   en ook de AI-leverancier verwerkt de berichten.
