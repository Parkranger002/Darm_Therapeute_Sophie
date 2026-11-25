-- Eigen webshop: producten, instellingen en bestellingen.
-- Bedragen in centen, inclusief btw.

CREATE TABLE IF NOT EXISTS producten (
  sku TEXT PRIMARY KEY,
  naam TEXT NOT NULL,
  lijn TEXT NOT NULL,            -- 'original' of 'pro'
  vorm TEXT NOT NULL,            -- bijv. 'Pot 150 gram'
  prijs_cent INTEGER,            -- NULL = nog geen prijs: niet te bestellen
  actief INTEGER NOT NULL DEFAULT 1,
  volgorde INTEGER NOT NULL DEFAULT 0,
  afbeelding TEXT,
  gewicht_g INTEGER              -- verzendgewicht, voor later
);

CREATE TABLE IF NOT EXISTS instellingen (
  sleutel TEXT PRIMARY KEY,
  waarde TEXT
);

CREATE TABLE IF NOT EXISTS bestellingen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nr TEXT UNIQUE,
  token TEXT NOT NULL,           -- geheim, voor de bedankpagina van de klant
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'open',      -- open, betaald, verzonden, geannuleerd, mislukt
  betaalstatus TEXT,                         -- zoals Mollie hem geeft
  naam TEXT NOT NULL, email TEXT NOT NULL, telefoon TEXT,
  straat TEXT NOT NULL, huisnummer TEXT NOT NULL, toevoeging TEXT,
  postcode TEXT NOT NULL, plaats TEXT NOT NULL, land TEXT NOT NULL DEFAULT 'NL',
  opmerking TEXT,
  regels TEXT NOT NULL,          -- JSON: [{sku,naam,aantal,prijs_cent}]
  subtotaal_cent INTEGER NOT NULL, verzend_cent INTEGER NOT NULL, totaal_cent INTEGER NOT NULL,
  mollie_id TEXT, testbetaling INTEGER NOT NULL DEFAULT 0, betaald_at TEXT,
  myparcel_id INTEGER, barcode TEXT, track_url TEXT, verzonden_at TEXT,
  notitie TEXT
);
CREATE INDEX IF NOT EXISTS bestellingen_status ON bestellingen (status);
CREATE INDEX IF NOT EXISTS bestellingen_mollie ON bestellingen (mollie_id);

-- Voorlopige prijzen: afgeleid van de prijsklassen op powerdetox.nl. Controleren in het beheer!
INSERT OR IGNORE INTO producten (sku, naam, lijn, vorm, prijs_cent, volgorde, afbeelding) VALUES
  ('orig-150', 'Darmmanagement Original', 'original', 'Pot 150 gram (30 porties)', 2495, 1, '/images/winkel/pot-original-150.webp'),
  ('orig-250', 'Darmmanagement Original', 'original', 'Pot 250 gram (50 porties)', 3695, 2, '/images/winkel/pot-original-250.webp'),
  ('orig-s7',  'Darmmanagement Original', 'original', '7 sachets van 5 gram', NULL, 3, '/images/winkel/sachet-original.webp'),
  ('orig-s21', 'Darmmanagement Original', 'original', '21 sachets van 5 gram', NULL, 4, '/images/winkel/sachet-original.webp'),
  ('pro-150',  'Darmmanagement PRO', 'pro', 'Pot 150 gram (30 porties)', 3295, 5, '/images/winkel/pot-pro-150.webp'),
  ('pro-250',  'Darmmanagement PRO', 'pro', 'Pot 250 gram (50 porties)', 4695, 6, '/images/winkel/pot-pro-250.webp'),
  ('pro-s7',   'Darmmanagement PRO', 'pro', '7 sachets van 5 gram', NULL, 7, '/images/winkel/sachet-pro.webp'),
  ('pro-s21',  'Darmmanagement PRO', 'pro', '21 sachets van 5 gram', NULL, 8, '/images/winkel/sachet-pro.webp');

INSERT OR IGNORE INTO instellingen (sleutel, waarde) VALUES
  ('verzendkosten_cent', '675'),
  ('gratis_verzending_vanaf_cent', '');
