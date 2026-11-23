/**
 * Veiligheidsregels, gedeeld door de browser (chatvenster) en de server (worker).
 *
 * LET OP: deze alarmsignalen en teksten zijn een eerste versie, gebaseerd op
 * Thuisarts.nl. Ze moeten vóór livegang worden getoetst door Sophie.
 */

export type AlarmKind = 'bloed' | 'pijn' | 'algemeen';

const ALARM_PATTERNS: Array<[AlarmKind, RegExp]> = [
  ['bloed', /bloed(?!druk|verdun|suiker|groep|onderzoek|prik|waarde|test|vat|arm)|zwarte ontlasting|zwarte poep|teerachtig|zwart(e)?\s+(en\s+)?(plakkerig|kleverig)|(poep|ontlasting|stoelgang)\s+(is|was|wordt|lijkt)\s+(\w+\s+)?zwart/],
  ['pijn', /(hevig|plotsel|ondraaglijk|heel erge?|ontzettende?|vreselijke?)\s*\w*\s*(buik)?pijn|pijn\s+(wordt|steeds)\s+erger/],
  [
    'algemeen',
    /koorts|overgeven|braken|kotsen|onbedoeld\s+(\d+\s*(kilo|kg)\s+)?(afgevallen|afvallen|gewichtsverlies)|afgevallen zonder|zonder\s+(reden|het te willen)\s+(\d+\s*(kilo|kg)\s+)?afgevallen|flauwvallen|flauw gevallen|kan niet plassen|niet meer poepen en (geen )?winden|ernstig ziek/,
  ],
];

/** Geeft het soort alarmsignaal terug, of null als er geen is. */
export function checkAlarm(text: string): AlarmKind | null {
  const t = text.toLowerCase();
  for (const [kind, re] of ALARM_PATTERNS) if (re.test(t)) return kind;
  return null;
}

export const ALARM_REPLIES: Record<AlarmKind, string[]> = {
  bloed: [
    'Bloed bij de ontlasting, of zwarte ontlasting, is iets om met een arts te bespreken. Ik raad je aan contact op te nemen met je huisarts.',
    'Verlies je veel bloed of voel je je ernstig ziek? Bel dan direct de huisarts of de huisartsenpost. Bij levensgevaar: bel 112.',
  ],
  pijn: [
    'Bij hevige of plotselinge buikpijn, of pijn die steeds erger wordt, is het belangrijk om direct medische hulp te zoeken. Wacht hiermee niet op advies van deze chat.',
    'Bel je huisarts, of buiten kantoortijden de huisartsenpost. Bij levensgevaar: bel 112.',
  ],
  algemeen: [
    'Dank je dat je dat vertelt. Bij deze klachten is een arts de juiste persoon. Neem contact op met je huisarts; voel je je ernstig ziek, bel dan direct de huisarts of de huisartsenpost.',
    'Ik geef je daarom nu geen productinformatie; die kan een medische beoordeling niet vervangen.',
  ],
};

/**
 * Uitspraken die de begeleider nooit mag doen (ziekteclaims bij het product,
 * diagnoses). Komt zo'n patroon voor in een AI-antwoord, dan wordt het
 * antwoord vervangen door een veilige tekst.
 */
const FORBIDDEN: RegExp[] = [
  /\b(geneest|genezen|geneesmiddel tegen)\b/i,
  /darmmanagement[^.!?\n]{0,80}\b(helpt|werkt|is goed|geschikt)\b[^.!?\n]{0,30}\b(tegen|bij|voor)\b[^.!?\n]{0,40}\b(pds|prikkelbare|crohn|colitis|divertik|kanker|poliep|ontsteking|ziekte|aandoening|eczeem|acne|overgewicht)/i,
  /\b(je hebt|u heeft|het is (zeker|waarschijnlijk)|dit is (zeker|waarschijnlijk))\b[^.!?\n]{0,30}\b(pds|prikkelbare darm|crohn|colitis|diverticulitis|darmkanker|poliepen)\b/i,
];

export const SAFE_FALLBACK =
  'Hier kan ik je geen antwoord op geven. Ik stel geen diagnoses, en Darmmanagement is een voedingssupplement dat ik nooit aan een ziekte koppel. Heb je vragen over klachten of een ziekte? Bespreek ze dan met je huisarts. Over je stoelgang, buikklachten of wat er in Darmmanagement zit, denk ik graag met je mee.';

/** Past de uitvoer van het model aan aan de reclame- en veiligheidsregels. */
export function filterOutput(text: string): { text: string; replaced: boolean } {
  if (FORBIDDEN.some((re) => re.test(text))) return { text: SAFE_FALLBACK, replaced: true };
  // Keuringsraad: niet het woord "probiotica" gebruiken.
  const cleaned = text
    .replace(/\bprobiotische\s+(stammen|bacteriestammen)\b/gi, 'bacteriestammen')
    .replace(/\bprobiotische\s+bacteriën\b/gi, 'levende bacteriën')
    .replace(/\bprobiotica\b/gi, 'levende bacteriën')
    .replace(/\bprobiotische?\s+([a-zà-ÿ]+)/gi, '$1 met levende bacteriën')
    .replace(/\bprobiotisch\b/gi, 'met levende bacteriën');
  return { text: cleaned, replaced: false };
}
