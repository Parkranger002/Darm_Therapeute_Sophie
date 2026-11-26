/**
 * Vragenlijst "Deel je ervaring". Gedeeld door het chatvenster (formulier)
 * en de worker (controle van de antwoorden).
 */

export type ChoiceQuestion = { id: string; label: string; options: string[]; required?: boolean };

export const CHOICES: ChoiceQuestion[] = [
  { id: 'product', label: 'Welk product heb je gebruikt?', options: ['Darmmanagement', 'Darmmanagement PLUS', 'Allebei', 'Weet ik niet meer'], required: true },
  { id: 'vorm', label: 'In welke vorm?', options: ['Pot', 'Sachets', 'Allebei'] },
  { id: 'duur', label: 'Hoe lang heb je het gebruikt?', options: ['Minder dan 2 weken', '2 tot 4 weken', '1 tot 3 maanden', 'Langer dan 3 maanden'], required: true },
  { id: 'porties', label: 'Hoeveel porties per dag?', options: ['1 portie', '2 porties', '3 porties', 'Wisselend'] },
  { id: 'mengen', label: 'Waar meng je het meestal door?', options: ['Water', 'Sap', 'Smoothie', 'Yoghurt', 'Anders'] },
  { id: 'nog_in_gebruik', label: 'Gebruik je het nu nog?', options: ['Ja', 'Nee'], required: true },
  { id: 'aanbevolen', label: 'Heb je het aan iemand aanbevolen?', options: ['Ja', 'Nee, maar dat zou ik wel doen', 'Nee'] },
];

export const TEVREDENHEID = { id: 'tevredenheid', label: 'Hoe tevreden ben je? (1 = niet, 5 = heel erg)', min: 1, max: 5 };

export const VERHAAL = {
  id: 'verhaal',
  label: 'Vertel in je eigen woorden over je ervaring',
  hint: 'Bijvoorbeeld over de smaak, het gemak en hoe het in je dag past. Schrijf liever niet over ziektes, diagnoses of medicijnen.',
  max: 1000,
};

export const PLAATSEN = {
  id: 'plaatsen',
  label: 'Mag je ervaring op de website komen?',
  options: ['Ja, met mijn voornaam', 'Ja, maar anoniem', 'Nee, alleen voor Darmmanagement'],
};

export const MAX_NAAM = 40;
export const MAX_EMAIL = 120;

export type Ervaring = {
  product: string; vorm?: string; duur: string; porties?: string; mengen?: string;
  nog_in_gebruik: string; aanbevolen?: string; tevredenheid?: number;
  verhaal?: string; plaatsen: string; voornaam?: string; email?: string;
};

/** Woorden die erop wijzen dat een ervaring een medische claim kan bevatten. */
const LET_OP = /genez|geneest|pds|prikkelbare|crohn|colitis|divertik|kanker|diagnose|medicijn|ziekte|ontsteking|aambei|eczeem|afgevallen|kilo/i;

export function letOp(text: string): string {
  const m = text.match(new RegExp(LET_OP.source, 'gi'));
  return m ? [...new Set(m.map((w) => w.toLowerCase()))].join(', ') : '';
}

/** Controleert de ingevulde vragenlijst. Geeft een foutmelding of null. */
export function validate(e: Partial<Ervaring>): string | null {
  for (const q of CHOICES) {
    const v = (e as Record<string, unknown>)[q.id];
    if (v === undefined || v === '') {
      if (q.required) return `Beantwoord de vraag: ${q.label}`;
      continue;
    }
    if (typeof v !== 'string' || !q.options.includes(v)) return 'Ongeldig antwoord.';
  }
  if (e.tevredenheid !== undefined && (!Number.isInteger(e.tevredenheid) || e.tevredenheid < 1 || e.tevredenheid > 5)) return 'Ongeldig antwoord.';
  if (typeof e.plaatsen !== 'string' || !PLAATSEN.options.includes(e.plaatsen)) return 'Geef aan of je ervaring op de website mag komen.';
  if (e.verhaal !== undefined && (typeof e.verhaal !== 'string' || e.verhaal.length > VERHAAL.max)) return 'Je verhaal is te lang.';
  if (e.plaatsen === PLAATSEN.options[0] && !(e.voornaam ?? '').trim()) return 'Vul je voornaam in, of kies "anoniem".';
  if (e.voornaam !== undefined && (typeof e.voornaam !== 'string' || e.voornaam.length > MAX_NAAM)) return 'Je voornaam is te lang.';
  if (e.email) {
    if (typeof e.email !== 'string' || e.email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)) return 'Controleer je e-mailadres.';
  }
  return null;
}
