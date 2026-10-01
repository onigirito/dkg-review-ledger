import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export class BusyError extends Error {}
export class Journal {
  constructor(file) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cache(url TEXT PRIMARY KEY, etag TEXT, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(name TEXT PRIMARY KEY, graph TEXT NOT NULL, repository TEXT NOT NULL,
        payload TEXT NOT NULL, status TEXT NOT NULL, receipt TEXT, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS leases(repository TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, repository TEXT, started_at INTEGER, finished_at INTEGER,
        outcome TEXT, details TEXT);`);
  }
  cache(url) { return this.db.prepare('SELECT * FROM cache WHERE url=?').get(url); }
  saveCache(url, etag, body) {
    this.db.prepare('INSERT INTO cache VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET etag=excluded.etag,body=excluded.body').run(url, etag, JSON.stringify(body));
  }
  prepare(asset) {
    this.db.prepare(`INSERT INTO assets VALUES(?,?,?,?,?,?,?) ON CONFLICT(name) DO NOTHING`)
      .run(asset.name, asset.contextGraphId, asset.artifact.repository, JSON.stringify(asset), 'prepared', null, Date.now());
    const saved = this.asset(asset.name);
    if (saved.payload !== JSON.stringify(asset)) throw new Error('Content identity collision; existing artifact was preserved.');
    return saved;
  }
  asset(name) { return this.db.prepare('SELECT * FROM assets WHERE name=?').get(name); }
  mark(name, status, receipt = null) {
    this.db.prepare('UPDATE assets SET status=?,receipt=?,updated_at=? WHERE name=?').run(status, receipt == null ? null : JSON.stringify(receipt), Date.now(), name);
  }
  assets(repository, limit = 100) {
    return this.db.prepare('SELECT name,graph,repository,status,receipt,updated_at FROM assets WHERE repository=? ORDER BY updated_at DESC LIMIT ?').all(repository, limit);
  }
  acquire(repository, owner, ttl = 120000) {
    const result = this.db.prepare(`INSERT INTO leases VALUES(?,?,?) ON CONFLICT(repository) DO UPDATE SET
      owner=excluded.owner,expires_at=excluded.expires_at WHERE leases.expires_at<?`)
      .run(repository, owner, Date.now() + ttl, Date.now());
    if (!result.changes) throw new BusyError('A repository sync is already in progress.');
  }
  assertOwner(repository, owner) {
    const lease = this.db.prepare('SELECT * FROM leases WHERE repository=?').get(repository);
    if (!lease || lease.owner !== owner || lease.expires_at <= Date.now()) throw new BusyError('Repository lease expired; reconcile before continuing.');
  }
  renew(repository, owner) {
    this.assertOwner(repository, owner);
    this.db.prepare('UPDATE leases SET expires_at=? WHERE repository=? AND owner=?').run(Date.now() + 120000, repository, owner);
  }
  release(repository, owner) { this.db.prepare('DELETE FROM leases WHERE repository=? AND owner=?').run(repository, owner); }
  startRun(repository) {
    return Number(this.db.prepare('INSERT INTO runs(repository,started_at,outcome) VALUES(?,?,?)').run(repository, Date.now(), 'running').lastInsertRowid);
  }
  finishRun(id, outcome, details) {
    this.db.prepare('UPDATE runs SET finished_at=?,outcome=?,details=? WHERE id=?').run(Date.now(), outcome, JSON.stringify(details), id);
  }
  close() { this.db.close(); }
}
