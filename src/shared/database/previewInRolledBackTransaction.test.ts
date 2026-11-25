import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { previewInRolledBackTransaction } from './previewInRolledBackTransaction';

describe('previewInRolledBackTransaction', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE items (name TEXT NOT NULL)');
  });
  afterEach(() => db.close());

  it('returns what the attempt produced and leaves no write behind', () => {
    const inserted = previewInRolledBackTransaction(db, () => {
      db.prepare('INSERT INTO items (name) VALUES (?)').run('draft');
      return db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM items').get()?.count;
    });
    expect(inserted).toBe(1);
    expect(db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM items').get()?.count).toBe(0);
  });

  it('passes the attempt’s own errors to the caller and still rolls back', () => {
    expect(() => previewInRolledBackTransaction(db, () => {
      db.prepare('INSERT INTO items (name) VALUES (?)').run('draft');
      throw new Error('validation failed');
    })).toThrow('validation failed');
    expect(db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM items').get()?.count).toBe(0);
  });
});
