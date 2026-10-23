import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { migrateV67ToV68MarkdownImageCaption } from '../v67-to-v68-markdown-image-caption';

it('adds an empty caption without converting filenames or changing image facts; rolls back with its enclosing migration', () => {
  const db = new Database(':memory:');
  try {
    db.exec(
      'CREATE TABLE image_blocks (id TEXT PRIMARY KEY, src TEXT NOT NULL, alt TEXT, title TEXT)'
    );
    db.prepare('INSERT INTO image_blocks VALUES (?, ?, ?, ?)').run(
      'image',
      'media://original',
      'IMG_123.png',
      'hover'
    );
    expect(() =>
      db.transaction(() => {
        migrateV67ToV68MarkdownImageCaption(db);
        throw new Error('abort');
      })()
    ).toThrow('abort');
    expect(db.prepare('PRAGMA table_info(image_blocks)').all()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'caption' })])
    );
    db.transaction(() => migrateV67ToV68MarkdownImageCaption(db))();
    expect(db.prepare('SELECT * FROM image_blocks').get()).toEqual({
      id: 'image',
      src: 'media://original',
      alt: 'IMG_123.png',
      title: 'hover',
      caption: '',
    });
  } finally {
    db.close();
  }
});
