-- Tabel voor ingevulde ervaringen (vragenlijst "Deel je ervaring" in de chat).
CREATE TABLE IF NOT EXISTS ervaringen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  product TEXT, vorm TEXT, duur TEXT, porties TEXT, mengen TEXT,
  nog_in_gebruik TEXT, tevredenheid INTEGER, aanbevolen TEXT,
  verhaal TEXT, plaatsen TEXT, voornaam TEXT, email TEXT,
  let_op TEXT, status TEXT NOT NULL DEFAULT 'nieuw'
);
