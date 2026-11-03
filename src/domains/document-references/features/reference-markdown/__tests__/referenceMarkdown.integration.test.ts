import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { parseMarkdownDocument, serializeMarkdownDocument } from '@linnya/markdown-document-core';
import { createDocumentReferenceMarkdownRuntime } from 'src/plugin-sdk/backend/documentReferences';
import type { JsonValue } from '@app/schemas';

const tagged: JsonValue = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'documentReference', attrs: { documentId: 'target', referenceId: 'ref-1' } }] }] };
function fixture() {
  const database = new Database(':memory:');
  database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY, project_id TEXT, name TEXT, type TEXT, deleted_at INTEGER, parent_id TEXT, last_opened_at INTEGER, updated_at INTEGER)');
  const insert = database.prepare('INSERT INTO workspace_nodes VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1)');
  insert.run('source', 'project', 'Source.md', 'document'); insert.run('target', 'project', 'Target Space.md', 'document');
  const runtime = createDocumentReferenceMarkdownRuntime(database);
  const identity = { readerId: 'conversation:run', sourceDocumentId: 'source', sourceKey: 'c1:1' };
  return { database, runtime, identity, read: () => runtime.registerRead({ ...identity, content: tagged }), write: (text: string) => runtime.admit({ ...identity, existingContent: tagged, content: parseMarkdownDocument(text) }) };
}

describe('trusted Markdown document reference bindings', () => {
  it('projects readable workspace paths and restores the original stable reference through the real parser', () => {
    const f = fixture();
    try {
      const read = f.read(); const markdown = serializeMarkdownDocument(read.content); expect(markdown).toContain('workspace:/Target%20Space.md');
      const prepared = f.write(markdown + '\n\nNew paragraph'); expect(prepared.references).toEqual([{ referenceId: 'ref-1', targetDocumentId: 'target', kind: 'inline' }]);
      expect(prepared.bindings[0]).toMatchObject({ referenceId: 'ref-1', targetDocumentId: 'target', path: 'workspace:/Target Space.md' });
      f.database.transaction(() => f.runtime.assertBindings({ sourceDocumentId: 'source', bindings: prepared.bindings }))();
    } finally { f.database.close(); }
  });
  it('rejects old paths after rename or same-path document replacement even if the label is edited', () => {
    const f = fixture();
    try {
      const text = serializeMarkdownDocument(f.read().content); f.database.prepare('UPDATE workspace_nodes SET name = ? WHERE id = ?').run('Renamed.md', 'target');
      f.database.prepare('INSERT INTO workspace_nodes VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1)').run('replacement', 'project', 'Target Space.md', 'document');
      expect(() => f.write(text)).toThrow('改名'); expect(() => f.write(text.replace('Target Space.md]', 'Changed label]'))).toThrow('改名');
      // 同一正文版本重读新路径也不能让旧链接重新绑定到 replacement。
      const fresh = serializeMarkdownDocument(f.read().content); expect(() => f.write(text)).toThrow('改名'); expect(f.write(fresh).references[0]?.targetDocumentId).toBe('target');
    } finally { f.database.close(); }
  });
  it('round-trips literal parentheses and percent signs in workspace document names', () => {
    const f = fixture();
    try {
      f.database.prepare('UPDATE workspace_nodes SET name = ? WHERE id = ?').run('Notes (100%).md', 'target');
      const text = serializeMarkdownDocument(f.read().content); expect(text).toContain('Notes%20%28100%25%29.md'); expect(f.write(text).references[0]?.targetDocumentId).toBe('target');
    } finally { f.database.close(); }
  });
  it('requires a trusted read for replacements containing prior tags and keeps reader scopes independent', () => {
    const f = fixture();
    try {
      expect(() => f.write('[Target Space.md](workspace:/Target%20Space.md)')).toThrow('可信读取'); const text = serializeMarkdownDocument(f.read().content);
      expect(() => f.runtime.admit({ ...f.identity, readerId: 'other-run', existingContent: tagged, content: parseMarkdownDocument(text) })).toThrow('可信读取');
      f.runtime.clearReader(f.identity.readerId); expect(() => f.write(text)).toThrow('可信读取');
    } finally { f.database.close(); }
  });
  it('rejects lossy replacements of invalid atoms and rechecks bindings after asynchronous preparation', () => {
    const f = fixture();
    try {
      const text = serializeMarkdownDocument(f.read().content); const prepared = f.write(text);
      f.database.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run('other-project', 'target');
      expect(() => f.runtime.assertBindings({ sourceDocumentId: 'source', bindings: prepared.bindings })).toThrow('改名');
      expect(() => f.write('Replacement before any new read')).toThrow('不能无损替换');
      const unavailable = f.read(); expect(unavailable.unprojectableReferenceIds).toEqual(['ref-1']); expect(JSON.stringify(unavailable.content)).not.toContain('Target Space');
      expect(() => f.write('Replace everything')).toThrow('不能无损替换');
      const appended = f.runtime.admit({ ...f.identity, content: parseMarkdownDocument('Only new paragraph') }); expect(appended.references).toEqual([]);
      expect(() => f.runtime.admit({ ...f.identity, content: parseMarkdownDocument(text) })).toThrow('改名');
    } finally { f.database.close(); }
  });
  it('resolves new links only in the current project and allocates independent IDs when copying a known tag', () => {
    const f = fixture();
    try {
      const text = serializeMarkdownDocument(f.read().content); const copied = f.write(text + ' and ' + text); expect(copied.references).toHaveLength(2); expect(new Set(copied.references.map(reference => reference.referenceId)).size).toBe(2);
      const added = f.runtime.admit({ ...f.identity, sourceKey: 'new', content: parseMarkdownDocument('[Target](workspace:/Target%20Space.md)') }); expect(added.references[0]?.targetDocumentId).toBe('target');
      f.database.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run('other-project', 'target'); expect(() => f.runtime.admit({ ...f.identity, sourceKey: 'new', content: parseMarkdownDocument('[Target](workspace:/Target%20Space.md)') })).toThrow('同项目');
    } finally { f.database.close(); }
  });
  it('records the delivered projection without re-reading and hydrates accepted proposals by stored identity', () => {
    const f = fixture();
    try {
      const read = f.runtime.project({ sourceDocumentId: 'source', content: tagged });
      const text = serializeMarkdownDocument(read.content);
      f.database.prepare('UPDATE workspace_nodes SET name = ? WHERE id = ?').run('Renamed.md', 'target');
      f.database.prepare('INSERT INTO workspace_nodes VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1)').run('replacement', 'project', 'Target Space.md', 'document');
      f.runtime.registerBindings({ ...f.identity, bindings: read.bindings, unprojectableReferenceIds: read.unprojectableReferenceIds });
      expect(() => f.write(text)).toThrow('改名');
      expect(f.runtime.hydrate({ content: parseMarkdownDocument(text), bindings: read.bindings })).toEqual(tagged);
      expect(() => f.runtime.hydrate({ content: parseMarkdownDocument('[Other](workspace:/Target%20Space.md)'), bindings: read.bindings })).toThrow('identity binding');
    } finally { f.database.close(); }
  });

  it('reports malformed authored workspace URI escapes as an actionable reference error', () => {
    const f = fixture();
    try { expect(() => f.runtime.admit({ ...f.identity, content: parseMarkdownDocument('[Bad](workspace:/100%.md)') })).toThrow('workspace 文档链接'); }
    finally { f.database.close(); }
  });

});
