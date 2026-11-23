/**
 * Meldingen ("tips") in de chat: de vezelcheck en de productkaart.
 *
 * Regels (Keuringsraad en de opzet van de begeleider):
 * - nooit na een alarmsignaal, en niet bij zwangerschap, kinderen, een
 *   bekende diagnose, medicijnen of allergie;
 * - productinformatie alleen als de bezoeker daar zelf ja op zegt;
 * - geen ziekteclaims: Darmmanagement is een manier om vezels aan te vullen.
 *
 * De vezelcheck is een grove schatting en blijft in de browser: de antwoorden
 * worden niet verstuurd of bewaard.
 */

export const HELPDESK = 'detoxhelpdesk@gmail.com';
export const SHOP_URL = 'https://darmmanagement.nl/';
export const PROEF_URL = 'https://www.powerdetox.nl/shop/gratis-probeerverpakking-darmmanagement/';

/** Onderwerpen waarbij de chat geen product aanbiedt. */
const SENSITIVE =
  /zwanger|borstvoeding|baby|kind|dochter|zoon|crohn|colitis|divertik|pds|prikkelbare|medicijn|medicatie|bloedverdun|antistolling|allergi|kanker|operatie|diabetes|ziekte/i;

export function isSensitive(text: string): boolean {
  return SENSITIVE.test(text);
}

/** Vraagt de bezoeker naar het product, de prijs of bestellen? */
export function asksAboutProduct(text: string): boolean {
  return /darmmanagement|\bpro\b|bestel|kopen|koop|prijs|kost|proefverpakking|supplement/i.test(text);
}

/** Gebruikt de bezoeker het product al? */
export function alreadyUses(text: string): boolean {
  return /ik (gebruik|neem|slik)[^.?!]{0,30}(darmmanagement|het al|het nu|al een tijd)/i.test(text);
}

export type CheckOption = { label: string; value: number };
export type CheckQuestion = { id: string; text: string; options: CheckOption[]; skipIf?: (a: Record<string, number>) => boolean };

/**
 * Grove vezelwaarden (afgerond), gebaseerd op openbare voedingstabellen:
 * snee volkoren brood ± 2,3 g, snee wit brood ± 1 g, groente ± 2,5 g per 100 g,
 * stuk fruit ± 2 g, portie peulvruchten ± 10 g, handje noten ± 1,5 g.
 */
export const CHECK: CheckQuestion[] = [
  {
    id: 'brood',
    text: 'Hoeveel sneetjes brood eet je op een gewone dag?',
    options: [
      { label: 'Geen', value: 0 },
      { label: '1 of 2', value: 1.5 },
      { label: '3 of 4', value: 3.5 },
      { label: '5 of meer', value: 5.5 },
    ],
  },
  {
    id: 'volkoren',
    text: 'Is dat meestal volkorenbrood?',
    skipIf: (a) => a.brood === 0,
    options: [
      { label: 'Ja, volkoren', value: 2.3 },
      { label: 'Wisselend', value: 1.6 },
      { label: 'Nee, wit of lichtbruin', value: 1 },
    ],
  },
  {
    id: 'groente',
    text: 'Hoeveel groente eet je per dag?',
    options: [
      { label: 'Weinig of geen', value: 1.2 },
      { label: 'Een portie bij het avondeten', value: 3.8 },
      { label: 'Veel, ook tussendoor of bij de lunch', value: 6.3 },
    ],
  },
  {
    id: 'fruit',
    text: 'Hoeveel stuks fruit eet je per dag?',
    options: [
      { label: 'Geen', value: 0 },
      { label: '1 stuk', value: 2 },
      { label: '2 of meer', value: 5 },
    ],
  },
  {
    id: 'extra',
    text: 'Hoe vaak eet je peulvruchten (zoals bonen of linzen), noten, havermout of muesli?',
    options: [
      { label: 'Zelden', value: 1 },
      { label: 'Een paar keer per week', value: 3.5 },
      { label: '(Bijna) elke dag', value: 7 },
    ],
  },
];

/** Vezels uit de rest van de voeding (aardappelen, pasta, rijst e.d.). */
const BASIS = 3;

export function estimateFibre(a: Record<string, number>): number {
  const brood = (a.brood ?? 0) * (a.volkoren ?? 1.6);
  const total = BASIS + brood + (a.groente ?? 0) + (a.fruit ?? 0) + (a.extra ?? 0);
  return Math.round(total);
}

export function fibreResult(grams: number): { lines: string[]; offer: boolean } {
  const head = `Volgens deze grove schatting eet je ongeveer ${grams} gram vezels per dag. Het Voedingscentrum adviseert volwassenen 30 tot 40 gram per dag.`;
  if (grams >= 30) {
    return {
      lines: [head, 'Goed bezig: je zit waarschijnlijk al op of rond het advies. Blijf vooral gevarieerd eten en genoeg drinken.'],
      offer: false,
    };
  }
  return {
    lines: [
      head,
      'Je eet dus waarschijnlijk minder vezels dan aangeraden. Daarin ben je niet de enige: veel Nederlanders halen het advies niet.',
      'Tips om meer vezels te eten:\n• kies volkorenbrood in plaats van wit\n• eet elke dag 250 gram groente en 2 stuks fruit\n• eet vaker peulvruchten, noten of havermout\n• bouw het rustig op en drink 1,5 tot 2 liter per dag',
    ],
    offer: true,
  };
}

/** Teksten van de productkaart: alleen etiketinformatie, geen claims. */
export const PRODUCT_CARD = {
  title: 'Darmmanagement PRO',
  lines: [
    'Vezelrijk: 3,6 gram vezels per portie van 5 gram',
    '70% psylliumvezel, negen kruiden en acht bacteriestammen (levende bacteriën)',
    'Door water, sap of een smoothie; begin met 1 schepje per dag',
    'Ook in sachets van 5 gram (per 7 of 21 stuks): handig voor op je werk of op vakantie',
  ],
  note: 'Een voedingssupplement vervangt geen gevarieerde voeding. Gebruik je medicijnen, ben je zwanger of geef je borstvoeding? Overleg dan eerst met je arts of apotheker.',
};

/** Gmail-venster om direct een bericht te schrijven (werkt ook zonder e-mailprogramma). */
export function gmailCompose(subject: string, body = ''): string {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to: HELPDESK, su: subject, body });
  return `https://mail.google.com/mail/?${q.toString()}`;
}

export const ERVARING_SUBJECT = 'Mijn ervaring met Darmmanagement';
export const ERVARING_BODY = 'Mijn ervaring:\n\n\nMag mijn ervaring (met alleen mijn voornaam) op de website worden geplaatst? Ja / Nee\nVoornaam:\n';

export function mailto(subject: string, body = ''): string {
  return `mailto:${HELPDESK}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;
}
