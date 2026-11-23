/**
 * Gespreksflow voor stap A (klikbaar prototype).
 *
 * Alle antwoorden zijn VASTE VOORBEELDTEKSTEN. Er draait nog geen AI.
 * Let op: de alarmsignalen en verwijsregels hieronder zijn voorbeelden.
 * Ze moeten vóór echt gebruik door een bevoegde zorgprofessional worden
 * opgesteld en getoetst.
 *
 * Productinformatie (ingrediënten, gebruik, waarschuwingen) komt later uit
 * een gecontroleerde productbron. Tot die gekoppeld is, zegt de begeleider
 * eerlijk dat de informatie ontbreekt.
 */

import { checkAlarm } from "./safety";

export type State = {
  klacht?: string;
  duur?: string;
  frequentie?: string;
  consistentie?: string;
  doel?: string;
  /** Na een veiligheidsroute wordt geen product meer aangeprezen. */
  safety?: boolean;
};

export type Option = {
  label: string;
  next: string;
  /** Sla het antwoord op in de samenvatting. */
  save?: [keyof State, string];
  /** Optionele toelichting (gebruikt bij de Bristol-kaart). */
  hint?: string;
};

export type Node = {
  say: (s: State) => string[];
  options?: (s: State) => Option[];
  /** Weergave van de opties: chips (standaard) of keuzekaart. */
  layout?: 'chips' | 'cards';
  /** Als de gebruiker hier typt, wordt de tekst opgeslagen i.p.v. geïnterpreteerd. */
  expectsText?: { key: keyof State; next: string };
  /** Markeer berichten als veiligheidsmelding (andere opmaak). */
  safety?: boolean;
};

const startOpties: Option[] = [
  { label: 'Mijn stoelgang', next: 'stoelgang' },
  { label: 'Ik heb buikklachten', next: 'buik' },
  { label: 'Vraag over Darmmanagement', next: 'product' },
  { label: 'Iets anders', next: 'anders' },
];

const naVeiligheid: Option[] = [
  { label: 'Ik heb een andere vraag', next: 'vraag' },
  { label: 'Gesprek afronden', next: 'einde' },
];

export const nodes: Record<string, Node> = {
  welkom: {
    say: () => [
      'Hallo! Ik help je graag met vragen over je darmen, stoelgang en Darmmanagement.',
      'Ik ben een AI-begeleider en geen arts. Bij ernstige of zorgwekkende klachten is een arts de juiste persoon.',
      'Waar wil je het vandaag over hebben?',
    ],
    options: () => startOpties,
  },

  // ── Stoelgang ──────────────────────────────────────────────
  stoelgang: {
    say: () => [
      'Fijn dat je het vertelt. Wat merk je vooral aan je stoelgang? Kies wat het best past, of beschrijf het in je eigen woorden.',
    ],
    options: () => [
      { label: 'Vaak dun of waterig', next: 'duur', save: ['klacht', 'vaak dunne ontlasting'] },
      { label: 'Vaak hard of verstopt', next: 'duur', save: ['klacht', 'vaak harde ontlasting of verstopping'] },
      { label: 'Wisselend', next: 'duur', save: ['klacht', 'wisselende stoelgang'] },
    ],
    expectsText: { key: 'klacht', next: 'duur' },
  },

  duur: {
    say: () => [
      'Ik stel je een paar korte vragen om beter te begrijpen wat je bedoelt. Hoelang merk je dit al?',
    ],
    options: () => [
      { label: 'Minder dan een week', next: 'alarm', save: ['duur', 'minder dan een week'] },
      { label: '1 tot 4 weken', next: 'alarm', save: ['duur', '1 tot 4 weken'] },
      { label: 'Langer dan een maand', next: 'alarm', save: ['duur', 'langer dan een maand'] },
    ],
    expectsText: { key: 'duur', next: 'alarm' },
  },

  // VOORBEELDREGEL – te toetsen door een zorgprofessional
  alarm: {
    say: () => [
      'Dan nog één belangrijke vraag, voor je veiligheid. Merk je een of meer van deze dingen?',
      '• bloed bij of in de ontlasting\n• hevige of plotselinge buikpijn\n• koorts of veel overgeven\n• onbedoeld afvallen',
    ],
    options: () => [
      { label: 'Ja, een of meer daarvan', next: 'veilig_algemeen' },
      { label: 'Nee, geen van deze', next: 'frequentie' },
    ],
  },

  frequentie: {
    say: (s) => [
      ...(s.duur === 'langer dan een maand'
        ? ['Omdat dit al langer dan een maand speelt, is het verstandig om het ook eens met je huisarts te bespreken. Dat kan gewoon naast dit gesprek.']
        : []),
      'Hoe vaak ga je ongeveer naar het toilet?',
    ],
    options: () => [
      { label: 'Minder dan 3 keer per week', next: 'beginmeting', save: ['frequentie', 'minder dan 3 keer per week'] },
      { label: '1 tot 3 keer per dag', next: 'beginmeting', save: ['frequentie', '1 tot 3 keer per dag'] },
      { label: 'Vaker dan 3 keer per dag', next: 'beginmeting', save: ['frequentie', 'vaker dan 3 keer per dag'] },
    ],
    expectsText: { key: 'frequentie', next: 'beginmeting' },
  },

  beginmeting: {
    say: () => [
      'Zou je samen willen vastleggen hoe het nu met je gaat? Dan kun je later gemakkelijker terugkijken of je iets merkt veranderen.',
    ],
    options: () => [
      { label: 'Ja, graag', next: 'bristol' },
      { label: 'Nee, liever niet', next: 'product_aanbod' },
    ],
  },

  bristol: {
    say: () => [
      'Welke beschrijving past het best bij je ontlasting van de afgelopen dagen? Dit is geen diagnose. Het helpt alleen om het te beschrijven.',
    ],
    layout: 'cards',
    options: () => [
      { label: 'Type 1', hint: 'Losse, harde keutels', next: 'doel', save: ['consistentie', 'type 1 (losse, harde keutels)'] },
      { label: 'Type 2', hint: 'Worstvormig, maar klonterig', next: 'doel', save: ['consistentie', 'type 2 (worstvormig, klonterig)'] },
      { label: 'Type 3', hint: 'Worstvormig met barstjes', next: 'doel', save: ['consistentie', 'type 3 (worstvormig met barstjes)'] },
      { label: 'Type 4', hint: 'Glad en zacht, als een worst', next: 'doel', save: ['consistentie', 'type 4 (glad en zacht)'] },
      { label: 'Type 5', hint: 'Zachte klodders met duidelijke randen', next: 'doel', save: ['consistentie', 'type 5 (zachte klodders)'] },
      { label: 'Type 6', hint: 'Brijig, met rafelige randen', next: 'doel', save: ['consistentie', 'type 6 (brijig)'] },
      { label: 'Type 7', hint: 'Waterig, zonder vaste delen', next: 'doel', save: ['consistentie', 'type 7 (waterig)'] },
    ],
  },

  doel: {
    say: () => ['Dank je. Wat zou je graag zien veranderen? Typ het gerust in je eigen woorden.'],
    options: () => [{ label: 'Sla deze vraag over', next: 'product_aanbod' }],
    expectsText: { key: 'doel', next: 'product_aanbod' },
  },

  // ── Buikklachten ───────────────────────────────────────────
  buik: {
    say: () => ['Vervelend dat je buikklachten hebt. Wat merk je vooral?'],
    options: () => [
      { label: 'Opgeblazen gevoel', next: 'duur', save: ['klacht', 'opgeblazen gevoel'] },
      { label: 'Krampen of lichte buikpijn', next: 'duur', save: ['klacht', 'krampen of lichte buikpijn'] },
      { label: 'Hevige of plotselinge pijn', next: 'veilig_pijn' },
    ],
    expectsText: { key: 'klacht', next: 'duur' },
  },

  // ── Veiligheidsroutes (geen productinformatie) ─────────────
  veilig_bloed: {
    safety: true,
    say: () => [
      'Bloed bij de ontlasting is iets om met een arts te bespreken. Ik raad je aan contact op te nemen met je huisarts.',
      'Als je je ernstig ziek voelt of veel bloed verliest, zoek dan direct medische hulp.',
    ],
    options: () => naVeiligheid,
  },
  veilig_pijn: {
    safety: true,
    say: () => [
      'Bij hevige of plotselinge buikpijn is het belangrijk om direct medische hulp te zoeken. Wacht hiermee niet op advies van deze chat.',
      'Bel je huisarts, of buiten kantoortijden de huisartsenpost. Bij een levensbedreigende situatie: bel 112.',
    ],
    options: () => naVeiligheid,
  },
  veilig_algemeen: {
    safety: true,
    say: () => [
      'Dank je dat je dat aangeeft. Bij deze klachten is een arts de juiste persoon. Neem contact op met je huisarts, en zoek direct medische hulp als je je ernstig ziek voelt.',
      'Ik geef je daarom nu geen productinformatie; die kan een medische beoordeling niet vervangen.',
    ],
    options: () => naVeiligheid,
  },

  // ── Product ────────────────────────────────────────────────
  product_aanbod: {
    say: (s) =>
      s.safety
        ? ['Omdat je klachten noemde waarvoor een arts de juiste persoon is, geef ik nu geen productinformatie. Bespreek je klachten eerst met je huisarts.']
        : ['Je bent benieuwd naar mogelijkheden om je stoelgang te ondersteunen. Wil je weten wat Darmmanagement is en wat er volgens de productinformatie in zit?'],
    options: (s) =>
      s.safety
        ? naVeiligheid
        : [
            { label: 'Ja, vertel maar', next: 'product' },
            { label: 'Ik wil nu geen productinformatie', next: 'afronden' },
          ],
  },

  product: {
    say: (s) =>
      s.safety
        ? ['Omdat je klachten noemde waarvoor een arts de juiste persoon is, geef ik nu geen productinformatie. Bespreek je klachten eerst met je huisarts.']
        : [
            'Darmmanagement PRO bevat volgens het etiket 70% psylliumvezel, negen kruiden en acht stammen levende bacteriën.',
            'Ik kan je vertellen wat er op het etiket staat en hoe het volgens de officiële instructies wordt gebruikt. Of het voor jou geschikt is, kan afhangen van je gezondheid en eventuele medicijnen. Bespreek dat bij twijfel met een arts of apotheker.',
          ],
    options: (s) =>
      s.safety
        ? naVeiligheid
        : [
            { label: 'Bekijk ingrediënten', next: 'ingredienten' },
            { label: 'Bekijk gebruiksinstructies', next: 'instructies' },
            { label: 'Vraag naar een proefverpakking', next: 'proef' },
            { label: 'Ik heb nog een vraag', next: 'vraag' },
            { label: 'Ik wil nu geen productinformatie', next: 'afronden' },
          ],
  },

  ingredienten: {
    say: () => [
      'Volgens het etiket zit dit in Darmmanagement PRO:',
      '• 70% psylliumvezel (Plantago ovata)\n• 9 kruiden: brandnetelblad, paardenbloemwortel, alfalfablad, rozenbottel, chlorella, gerstgras, fenegriekzaad, gemberwortel en hysopkruid\n• 8 bacteriestammen, samen 2,5 miljard levende bacteriën per portie van 5 gram\n• Drager: maïszetmeel en maltodextrine',
      'Let op: alfalfa en chlorella bevatten van nature vitamine K (belangrijk als je bloedverdunners gebruikt), en fenegriek kan een kruisreactie geven als je allergisch bent voor pinda of peulvruchten. Twijfel je? Overleg dan eerst met je arts of apotheker. Op de productpagina staat alles op een rij.',
    ],
    options: () => productTerug,
  },
  instructies: {
    say: () => [
      'Volgens de gebruiksaanwijzing begin je met één portie per dag: één afgestreken maatschepje van 5 gram. Als je wilt, bouw je geleidelijk op tot maximaal 3 porties (15 gram) per dag, verdeeld over de dag.',
      'Roer een portie door een groot glas water, sap of smoothie (minstens 200 ml), drink het meteen op en drink daarna nog een glas water. Niet vlak voor het slapengaan innemen, en houd minstens 1 uur afstand tot je medicijnen.',
      'Ben je zwanger, geef je borstvoeding, gebruik je medicijnen of heb je klachten? Overleg dan eerst met je arts of apotheker.',
    ],
    options: () => productTerug,
  },
  proef: {
    say: () => [
      'Leuk dat je interesse hebt. Een gratis probeerverpakking van Darmmanagement PRO (50 gram, 10 porties) vraag je aan op powerdetox.nl: https://www.powerdetox.nl/shop/gratis-probeerverpakking-darmmanagement/',
    ],
    options: () => productTerug,
  },

  // ── Open vragen ────────────────────────────────────────────
  anders: {
    say: () => ['Vertel gerust in je eigen woorden waar je mee zit.'],
  },
  vraag: {
    say: () => ['Wat wil je nog vragen?'],
  },
  onbekend: {
    say: () => [
      'Daar heb ik nu geen vast antwoord op. Probeer het over een paar minuten opnieuw, of mail je vraag naar de Detox helpdesk: detoxhelpdesk@gmail.com.',
      'Kan ik je ergens anders mee helpen?',
    ],
    options: () => startOpties,
  },

  // ── Afronden ───────────────────────────────────────────────
  afronden: {
    say: (s) => [
      ...(s.klacht
        ? [`We hebben besproken dat je last hebt van ${s.klacht}${s.duur ? `, ${s.duur}` : ''}. Je kunt later terugkomen om je ervaringen te bespreken.`]
        : ['Fijn dat je even langskwam. Je kunt altijd terugkomen met een nieuwe vraag.']),
      'Heb je op dit moment nog een vraag?',
    ],
    options: () => [
      { label: 'Ik heb nog een vraag', next: 'vraag' },
      { label: 'Bekijk mijn samenvatting', next: 'samenvatting' },
      { label: 'Gesprek afronden', next: 'einde' },
    ],
  },

  samenvatting: {
    say: (s) => {
      const r: string[] = [];
      if (s.klacht) r.push(`• Wat je merkt: ${s.klacht}`);
      if (s.duur) r.push(`• Hoelang al: ${s.duur}`);
      if (s.frequentie) r.push(`• Hoe vaak: ${s.frequentie}`);
      if (s.consistentie) r.push(`• Consistentie: ${s.consistentie}`);
      if (s.doel) r.push(`• Wat je wilt veranderen: ${s.doel}`);
      if (!r.length) return ['Je hebt in dit gesprek nog geen gegevens over je klachten gedeeld, dus er is niets samen te vatten.'];
      return [
        'Dit is wat je zelf hebt verteld:',
        r.join('\n'),
        'Klopt dit? Zo niet, begin dan opnieuw. In deze versie wordt niets opgeslagen: de samenvatting verdwijnt als je de pagina sluit.',
      ];
    },
    options: () => [
      { label: 'Klopt', next: 'einde' },
      { label: 'Opnieuw beginnen', next: '__reset' },
    ],
  },

  einde: {
    say: () => [
      'Dank je wel voor het gesprek. Houden je klachten aan of worden ze erger? Neem dan contact op met je huisarts.',
    ],
    options: () => [{ label: 'Nieuw gesprek', next: '__reset' }],
  },
};

const productTerug: Option[] = [
  { label: 'Terug naar productinformatie', next: 'product' },
  { label: 'Ik heb nog een vraag', next: 'vraag' },
  { label: 'Gesprek afronden', next: 'afronden' },
];

/**
 * Interpreteer vrije tekst. Alarmsignalen worden ALTIJD eerst gecontroleerd,
 * ook als de begeleider op een antwoord wacht.
 * VOORBEELDREGELS – te vervangen door getoetste veiligheidsregels.
 */
export function classify(text: string): { next: string; save?: [keyof State, string] } | null {
  const kind = checkAlarm(text);
  return kind ? { next: `veilig_${kind}` } : null;
}

export function interpret(text: string): { next: string; save?: [keyof State, string] } {
  const alarm = classify(text);
  if (alarm) return alarm;
  const t = text.toLowerCase();
  if (/darmmanagement|product|ingredi|proef|bestel|kopen|etiket|pro\b/.test(t)) return { next: 'product_aanbod' };
  if (/dun|diarree|waterig/.test(t)) return { next: 'duur', save: ['klacht', 'vaak dunne ontlasting'] };
  if (/verstop|obstipatie|hard/.test(t)) return { next: 'duur', save: ['klacht', 'harde ontlasting of verstopping'] };
  if (/opgeblazen|kramp|buikpijn|winderig|gassen|buik/.test(t)) return { next: 'buik' };
  if (/stoelgang|ontlasting|poep|toilet/.test(t)) return { next: 'stoelgang' };
  if (/^(hallo|hoi|hey|hi|goedemorgen|goedemiddag|goedenavond)\b/.test(t)) return { next: 'welkom' };
  return { next: 'onbekend' };
}
