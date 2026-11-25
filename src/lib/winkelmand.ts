// Winkelmand in de browser (alleen sku + aantal). Prijzen komen altijd van de server.
export const SHOP = '/shop-concept';
const KEY = 'dm-winkelmand';

export type Item = { sku: string; aantal: number };
export type Product = { sku: string; naam: string; lijn: string; vorm: string; prijs_cent: number | null; afbeelding: string | null };
export type Catalogus = { producten: Product[]; verzendkosten_cent: number; gratis_vanaf_cent: number; testmodus: boolean };

let geheugen: Item[] = []; // reserve als opslag in de browser niet werkt

export function lees(): Item[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((i) => typeof i?.sku === 'string' && i.aantal > 0) : [];
  } catch {
    return geheugen;
  }
}
export function schrijf(items: Item[]) {
  geheugen = items.filter((i) => i.aantal > 0).map((i) => ({ sku: i.sku, aantal: Math.min(20, Math.floor(i.aantal)) }));
  try { localStorage.setItem(KEY, JSON.stringify(geheugen)); } catch { /* geheugen volstaat */ }
  dispatchEvent(new CustomEvent('winkelmand'));
}
export function voegToe(sku: string, aantal = 1) {
  const items = lees();
  const i = items.find((x) => x.sku === sku);
  if (i) i.aantal += aantal; else items.push({ sku, aantal });
  schrijf(items);
}
export function zet(sku: string, aantal: number) {
  schrijf(lees().map((i) => (i.sku === sku ? { ...i, aantal } : i)));
}
export function leeg() { schrijf([]); }

export const euro = (cent: number) => '€ ' + (cent / 100).toFixed(2).replace('.', ',');

export async function catalogus(): Promise<Catalogus> {
  const r = await fetch(`${SHOP}/api/producten`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('catalogus');
  return r.json();
}

export function totalen(items: Item[], cat: Catalogus) {
  const regels = items
    .map((i) => ({ ...i, p: cat.producten.find((p) => p.sku === i.sku) }))
    .filter((r): r is Item & { p: Product & { prijs_cent: number } } => !!r.p && r.p.prijs_cent !== null);
  const subtotaal = regels.reduce((s, r) => s + r.aantal * r.p.prijs_cent, 0);
  const verzend = !regels.length ? 0 : cat.gratis_vanaf_cent > 0 && subtotaal >= cat.gratis_vanaf_cent ? 0 : cat.verzendkosten_cent;
  return { regels, subtotaal, verzend, totaal: subtotaal + verzend, aantal: regels.reduce((s, r) => s + r.aantal, 0) };
}
