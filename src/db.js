import Database from 'better-sqlite3';
import { config } from './config.js';

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS units (
  callsign    TEXT PRIMARY KEY,
  discord_id  TEXT,
  roblox_name TEXT,
  status      TEXT NOT NULL DEFAULT '10-7',
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  location    TEXT,
  priority    INTEGER NOT NULL DEFAULT 3,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  closed_at   INTEGER
);
CREATE TABLE IF NOT EXISTS call_units (
  call_id  INTEGER NOT NULL,
  callsign TEXT NOT NULL,
  PRIMARY KEY (call_id, callsign)
);
CREATE TABLE IF NOT EXISTS bolos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS event_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

export function logEvent(kind, detail) {
  db.prepare('INSERT INTO event_log (kind, detail) VALUES (?, ?)').run(kind, detail);
}

export function upsertUnit(callsign, fields = {}) {
  db.prepare('INSERT INTO units (callsign) VALUES (?) ON CONFLICT(callsign) DO NOTHING').run(callsign);
  for (const [k, v] of Object.entries(fields)) {
    if (!['discord_id', 'roblox_name', 'status'].includes(k)) continue;
    db.prepare(`UPDATE units SET ${k} = ?, updated_at = unixepoch() WHERE callsign = ?`).run(v, callsign);
  }
  return db.prepare('SELECT * FROM units WHERE callsign = ?').get(callsign);
}

export const getUnit = (cs) => db.prepare('SELECT * FROM units WHERE callsign = ?').get(cs);
export const getUnitByDiscord = (id) => db.prepare('SELECT * FROM units WHERE discord_id = ?').get(id);
export const getUnitByRoblox = (name) =>
  db.prepare('SELECT * FROM units WHERE roblox_name = ? COLLATE NOCASE').get(name);
export const listUnits = () => db.prepare('SELECT * FROM units ORDER BY callsign').all();

export function createCall(description, location, priority = 3) {
  const r = db.prepare('INSERT INTO calls (description, location, priority) VALUES (?, ?, ?)')
    .run(description, location, priority);
  return r.lastInsertRowid;
}
export const getCall = (id) => db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
export const openCalls = () =>
  db.prepare("SELECT * FROM calls WHERE status = 'open' ORDER BY priority, id").all();
export function closeCall(id) {
  return db.prepare("UPDATE calls SET status = 'closed', closed_at = unixepoch() WHERE id = ? AND status = 'open'")
    .run(id).changes > 0;
}
export function attachUnit(callId, callsign) {
  db.prepare('INSERT OR IGNORE INTO call_units (call_id, callsign) VALUES (?, ?)').run(callId, callsign);
}
export const callUnits = (callId) =>
  db.prepare('SELECT callsign FROM call_units WHERE call_id = ?').all(callId).map(r => r.callsign);

export function addBolo(description) {
  return db.prepare('INSERT INTO bolos (description) VALUES (?)').run(description).lastInsertRowid;
}
export const activeBolos = () => db.prepare('SELECT * FROM bolos WHERE active = 1 ORDER BY id DESC').all();

export default db;
