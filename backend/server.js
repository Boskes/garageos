import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'garageos.db'));

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS klanten (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voornaam TEXT NOT NULL,
    achternaam TEXT NOT NULL,
    telefoon TEXT,
    email TEXT,
    aangemaakt_op TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS voertuigen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    klant_id INTEGER REFERENCES klanten(id),
    nummerplaat TEXT NOT NULL,
    merk TEXT,
    model TEXT,
    jaar INTEGER,
    vin TEXT,
    km_stand INTEGER,
    aangemaakt_op TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS werkopdrachten (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voertuig_id INTEGER REFERENCES voertuigen(id),
    status TEXT DEFAULT 'open',
    beschrijving TEXT,
    onderdelen_json TEXT DEFAULT '[]',
    totaalbedrag REAL DEFAULT 0,
    aangemaakt_op TEXT DEFAULT (datetime('now')),
    bijgewerkt_op TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS whatsapp_berichten (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    werkopdracht_id INTEGER REFERENCES werkopdrachten(id),
    richting TEXT DEFAULT 'uit',
    bericht TEXT,
    verstuurd_op TEXT DEFAULT (datetime('now'))
  );
`);

// Seed als leeg
const { n: klantenCount } = db.prepare('SELECT COUNT(*) as n FROM klanten').get();
if (klantenCount === 0) {
  const insertK = db.prepare('INSERT INTO klanten (voornaam, achternaam, telefoon, email) VALUES (?, ?, ?, ?)');
  const insertV = db.prepare('INSERT INTO voertuigen (klant_id, nummerplaat, merk, model, jaar, vin, km_stand) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertW = db.prepare('INSERT INTO werkopdrachten (voertuig_id, status, beschrijving, totaalbedrag) VALUES (?, ?, ?, ?)');

  const k1 = insertK.run('Jan', 'Peeters', '+32 476 12 34 56', 'jan.peeters@gmail.com');
  const k2 = insertK.run('Marie', 'Janssen', '+32 486 23 45 67', 'marie.janssen@outlook.be');
  const k3 = insertK.run('Tom', 'Declercq', '+32 496 34 56 78', 'tom.declercq@telenet.be');
  const k4 = insertK.run('Sara', 'Willems', '+32 468 45 67 89', 'sara.willems@proximus.be');

  const v1 = insertV.run(k1.lastInsertRowid, '1-ABC-234', 'Volkswagen', 'Golf VIII', 2021, 'VIN1HGBH41JXMN109186', 145000);
  const v2 = insertV.run(k2.lastInsertRowid, '2-DEF-567', 'Renault', 'Clio', 2019, 'VIN2HGBH41JXMN209187', 89000);
  const v3 = insertV.run(k3.lastInsertRowid, '3-GHI-890', 'BMW', '3 Serie', 2020, 'VIN3HGBH41JXMN309188', 67000);
  const v4 = insertV.run(k4.lastInsertRowid, '4-JKL-123', 'Ford', 'Focus', 2018, 'VIN4HGBH41JXMN409189', 203000);

  insertW.run(v2.lastInsertRowid, 'bezig', 'Banden wisselen', 287.50);
  insertW.run(v1.lastInsertRowid, 'klaar', 'Oliewissel + remmen', 543.00);
  insertW.run(v3.lastInsertRowid, 'open', 'APK keuring', 0);
  insertW.run(v4.lastInsertRowid, 'bezig', 'Riem + vloeistoffen', 0);

  console.log('✅ Seed data aangemaakt');
}

const app = express();
const PORT = 3002;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Dashboard stats ────────────────────────────────────────────────────────────
app.get('/api/dashboard/stats', (_req, res) => {
  const klanten = db.prepare('SELECT COUNT(*) as n FROM klanten').get().n;
  const voertuigen = db.prepare('SELECT COUNT(*) as n FROM voertuigen').get().n;
  const open = db.prepare("SELECT COUNT(*) as n FROM werkopdrachten WHERE status IN ('open','bezig')").get().n;
  const vandaag = new Date().toISOString().split('T')[0];
  const omzetRow = db.prepare("SELECT COALESCE(SUM(totaalbedrag),0) as s FROM werkopdrachten WHERE status='klaar' AND DATE(bijgewerkt_op)=?").get(vandaag);
  res.json({ klanten, voertuigen, open, omzet: omzetRow.s });
});

// ── Klanten ────────────────────────────────────────────────────────────────────
app.get('/api/klanten', (_req, res) => {
  const klanten = db.prepare('SELECT * FROM klanten ORDER BY id DESC').all();
  // Voeg voertuigcount toe
  const result = klanten.map(k => ({
    ...k,
    voertuigen_count: db.prepare('SELECT COUNT(*) as n FROM voertuigen WHERE klant_id=?').get(k.id).n
  }));
  res.json(result);
});

app.post('/api/klanten', (req, res) => {
  const { voornaam, achternaam, telefoon, email } = req.body;
  if (!voornaam || !achternaam) return res.status(400).json({ error: 'voornaam en achternaam zijn verplicht' });
  const r = db.prepare('INSERT INTO klanten (voornaam, achternaam, telefoon, email) VALUES (?, ?, ?, ?)').run(voornaam, achternaam, telefoon || null, email || null);
  res.status(201).json(db.prepare('SELECT * FROM klanten WHERE id=?').get(r.lastInsertRowid));
});

app.get('/api/klanten/:id', (req, res) => {
  const k = db.prepare('SELECT * FROM klanten WHERE id=?').get(req.params.id);
  k ? res.json(k) : res.status(404).json({ error: 'Niet gevonden' });
});

app.put('/api/klanten/:id', (req, res) => {
  const { voornaam, achternaam, telefoon, email } = req.body;
  db.prepare('UPDATE klanten SET voornaam=?, achternaam=?, telefoon=?, email=? WHERE id=?').run(voornaam, achternaam, telefoon, email, req.params.id);
  res.json(db.prepare('SELECT * FROM klanten WHERE id=?').get(req.params.id));
});

app.delete('/api/klanten/:id', (req, res) => {
  db.prepare('DELETE FROM klanten WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Voertuigen ─────────────────────────────────────────────────────────────────
app.get('/api/voertuigen', (_req, res) => {
  const rows = db.prepare(`
    SELECT v.*, k.voornaam || ' ' || k.achternaam as eigenaar
    FROM voertuigen v
    LEFT JOIN klanten k ON v.klant_id = k.id
    ORDER BY v.id DESC
  `).all();
  res.json(rows);
});

app.post('/api/voertuigen', (req, res) => {
  const { klant_id, nummerplaat, merk, model, jaar, vin, km_stand } = req.body;
  if (!nummerplaat) return res.status(400).json({ error: 'nummerplaat is verplicht' });
  const r = db.prepare('INSERT INTO voertuigen (klant_id, nummerplaat, merk, model, jaar, vin, km_stand) VALUES (?, ?, ?, ?, ?, ?, ?)').run(klant_id || null, nummerplaat, merk || null, model || null, jaar || null, vin || null, km_stand || null);
  res.status(201).json(db.prepare('SELECT * FROM voertuigen WHERE id=?').get(r.lastInsertRowid));
});

app.get('/api/voertuigen/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM voertuigen WHERE id=?').get(req.params.id);
  v ? res.json(v) : res.status(404).json({ error: 'Niet gevonden' });
});

app.put('/api/voertuigen/:id', (req, res) => {
  const { nummerplaat, merk, model, jaar, vin, km_stand } = req.body;
  db.prepare('UPDATE voertuigen SET nummerplaat=?, merk=?, model=?, jaar=?, vin=?, km_stand=? WHERE id=?').run(nummerplaat, merk, model, jaar, vin, km_stand, req.params.id);
  res.json(db.prepare('SELECT * FROM voertuigen WHERE id=?').get(req.params.id));
});

// ── Werkopdrachten ─────────────────────────────────────────────────────────────
app.get('/api/werkopdrachten', (_req, res) => {
  const rows = db.prepare(`
    SELECT w.*,
           v.nummerplaat, v.merk, v.model,
           k.voornaam || ' ' || k.achternaam as klant
    FROM werkopdrachten w
    LEFT JOIN voertuigen v ON w.voertuig_id = v.id
    LEFT JOIN klanten k ON v.klant_id = k.id
    ORDER BY w.id DESC
  `).all();
  res.json(rows);
});

app.post('/api/werkopdrachten', (req, res) => {
  const { voertuig_id, status, beschrijving, onderdelen_json, totaalbedrag } = req.body;
  const r = db.prepare('INSERT INTO werkopdrachten (voertuig_id, status, beschrijving, onderdelen_json, totaalbedrag) VALUES (?, ?, ?, ?, ?)').run(
    voertuig_id || null, status || 'open', beschrijving || null,
    JSON.stringify(onderdelen_json || []), totaalbedrag || 0
  );
  res.status(201).json(db.prepare('SELECT * FROM werkopdrachten WHERE id=?').get(r.lastInsertRowid));
});

app.get('/api/werkopdrachten/:id', (req, res) => {
  const w = db.prepare('SELECT * FROM werkopdrachten WHERE id=?').get(req.params.id);
  w ? res.json(w) : res.status(404).json({ error: 'Niet gevonden' });
});

app.put('/api/werkopdrachten/:id', (req, res) => {
  const { status, beschrijving, onderdelen_json, totaalbedrag } = req.body;
  db.prepare(`UPDATE werkopdrachten SET status=?, beschrijving=?, onderdelen_json=?, totaalbedrag=?, bijgewerkt_op=datetime('now') WHERE id=?`).run(
    status, beschrijving, JSON.stringify(onderdelen_json || []), totaalbedrag, req.params.id
  );
  res.json(db.prepare('SELECT * FROM werkopdrachten WHERE id=?').get(req.params.id));
});

// ── WhatsApp ───────────────────────────────────────────────────────────────────
app.post('/api/whatsapp/stuur', (req, res) => {
  const { werkopdracht_id, bericht } = req.body;
  const r = db.prepare('INSERT INTO whatsapp_berichten (werkopdracht_id, richting, bericht) VALUES (?, ?, ?)').run(werkopdracht_id || null, 'uit', bericht || '');
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.get('/api/whatsapp/:werkopdracht_id', (req, res) => {
  res.json(db.prepare('SELECT * FROM whatsapp_berichten WHERE werkopdracht_id=? ORDER BY id DESC').all(req.params.werkopdracht_id));
});

// ── Catch-all SPA ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚗 GarageOS draait op http://localhost:${PORT}`);
});
