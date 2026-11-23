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

## De AI-chat (stap B)

De chat praat met Claude via een Cloudflare Worker (`worker/index.ts`). Er wordt niets opgeslagen.

**Hoe een bericht loopt:**
1. In de browser en op de server wordt eerst gecontroleerd op alarmsignalen (`src/lib/safety.ts`). Zo ja: een vast doorverwijsantwoord, zonder AI.
2. Anders gaat het gesprek naar Claude, met de instructies, de productinformatie en de kennisbank (`src/knowledge/*.md`). Claude mag zoeken op een vaste lijst sites (thuisarts.nl, voedingscentrum.nl, rivm.nl, mlds.nl, crohn-colitis.nl, darmmanagement.nl, powerdetox.nl).
3. Het antwoord gaat door een filter: geen ziekteclaims, geen diagnoses, geen woord "probiotica".
4. Is de AI niet bereikbaar, dan valt de chat terug op de vaste antwoorden (`src/lib/flow.ts`).

**Inhoud aanpassen:** bewerk de bestanden in `src/knowledge/`:
- `instructies.md`: toon en regels van de begeleider
- `product.md`: etiketinformatie (de enige productinformatie die de AI gebruikt)
- `aandoeningen.md`: kennisbank over aandoeningen en wanneer naar de huisarts

Elke wijziging op `main` wordt automatisch gebouwd en gepubliceerd door Cloudflare.

**Instellingen in Cloudflare** (Workers & Pages → darmmanagement-begeleider → Settings → Variables and Secrets):
- `ANTHROPIC_API_KEY` (Secret): de API-sleutel van Anthropic. Zonder sleutel gebruikt de chat de vaste antwoorden.
- `MODEL` (in `wrangler.jsonc`): standaard `claude-sonnet-5-5`.

**Misbruik beperken:** maximaal 12 berichten per IP-adres per minuut, berichten max. 1000 tekens, alleen verzoeken vanaf de eigen site.

**Lokaal testen:** maak een bestand `.dev.vars` met `ANTHROPIC_API_KEY=...` (staat in `.gitignore`), dan `npm run build && npx wrangler dev`.

**Testen vóór livegang:** zie `docs/testset.md`.

> De alarmsignalen, instructies en kennisbank zijn een eerste versie en worden getoetst door Sophie.
