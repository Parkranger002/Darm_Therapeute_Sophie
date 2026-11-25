-- Herroepingen via de knop "Koop ongedaan maken" (verplicht sinds juni 2026).
CREATE TABLE IF NOT EXISTS herroepingen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bestelling_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),   -- moment van herroepen (UTC)
  regels TEXT NOT NULL,          -- JSON: [{sku,naam,vorm,aantal}] die de klant terugstuurt
  geheel INTEGER NOT NULL DEFAULT 1,                     -- 1 = hele bestelling
  status TEXT NOT NULL DEFAULT 'ontvangen',              -- ontvangen, afgehandeld
  afgehandeld_at TEXT,
  notitie TEXT
);
CREATE INDEX IF NOT EXISTS herroepingen_bestelling ON herroepingen (bestelling_id);
