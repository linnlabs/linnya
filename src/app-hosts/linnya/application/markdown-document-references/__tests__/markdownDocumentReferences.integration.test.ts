import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { createProjectLifecycle } from 'src/domains/projects';
import { createMarkdownReadDatabase, readMarkdownVfsContent, PendingRevisionApplyService } from 'src/domains/markdown';
import { listDocumentBacklinks } from 'src/plugin-sdk/backend/documentReferences';
import { collectMarkdownDocumentReferences } from 'src/domains/markdown/features/document-references';
import { createMarkdownDocumentStore } from '../../markdown-image-assets';
import { getMarkdownDocumentReferenceRuntime } from '..';
import { readFileForTool } from '../../file-read/orchestration/readFileForTool';
import { WorkspaceReadFileArgsSchema } from '@app/schemas';
import { createWorkspaceDocumentFileCreateProviderResolver } from '../../../adapters/document-file-create/createWorkspaceDocumentFileCreateProviderResolver';
import { createWorkspaceDocumentFileWriteProviderResolver } from '../../../adapters/document-file-write/createWorkspaceDocumentFileWriteProviderResolver';

const context = { conversationId: 'references-conversation', runId: RunIdSchema.parse('run-1') };
let database: DatabaseService;
function fixture() {
  const db = database.getDb(); const workspace = new WorkspaceService(db);
  const projectId = createProjectLifecycle(db).create({ name: 'References' });
  const targetId = workspace.createDocument(projectId, 'Target.md', null, 'document');
  const creator = createWorkspaceDocumentFileCreateProviderResolver({ db, context, workspaceService: workspace })('source.md');
  const writer = createWorkspaceDocumentFileWriteProviderResolver({ db, context })('document');
  if (!creator || !writer) throw new Error('Markdown providers missing');
  return { db, workspace, projectId, targetId, creator, writer };
}
beforeEach(() => { database = new DatabaseService(':memory:'); database.initialize(); });
afterEach(() => database.close());

async function source() {
  const f = fixture();
  const created = await f.creator.create({ projectId: f.projectId, parentPath: '/', name: 'source.md', content: 'See [Target.md](workspace:/Target.md)' });
  const documentId = created.documentId;
  const store = createMarkdownDocumentStore(f.db);
  const identity = { documentId, documentName: 'source.md', documentType: 'document', projectId: f.projectId, path: '/source.md', inode: `workspace:${documentId}` };
  function read(register = true) {
    const result = readMarkdownVfsContent({ db: createMarkdownReadDatabase(f.db), documentId });
    if (!result) throw new Error('No source document');
    if (register) getMarkdownDocumentReferenceRuntime(f.db).registerBindings({ readerId: JSON.stringify([context.conversationId, context.runId]), sourceDocumentId: documentId, ...result.metadata.documentReferences });
    return result;
  }
  function decide(mode: 'accept' | 'reject') {
    return new PendingRevisionApplyService(store).commitEditorRevision({ documentId, expectedVersionNumber: store.getLatestVersion(documentId)!.version_number, expectedPending: store.getPendingRevisions(documentId).map(({ id, revision }) => ({ id, revision })), baseline: store.getDocument(documentId), decision: { mode } });
  }
  return { ...f, identity, store, read, decide };
}

describe('Markdown stable document reference read/write/proposal lifecycle', () => {
  it('creates real tags and backlinks, projects current proposal paths, and accepts the original identity after same-path replacement', async () => {
    const f = await source(); const documentId = f.identity.documentId;
    const original = collectMarkdownDocumentReferences(f.store.getDocument(documentId));
    expect(original).toEqual([{ referenceId: expect.any(String), targetDocumentId: f.targetId, kind: 'inline' }]);
    expect(listDocumentBacklinks(f.db, f.targetId)).toHaveLength(1);
    const before = f.read();
    await f.writer.write({ identity: f.identity, operation: 'write', content: before.text + ' changed' });
    expect(f.store.getPendingRevisions(documentId)).toHaveLength(1);
    f.db.prepare('UPDATE workspace_nodes SET name = ? WHERE id = ?').run('Renamed.md', f.targetId);
    const replacement = f.workspace.createDocument(f.projectId, 'Target.md', null, 'document');
    const preview = f.read(); expect(preview.text).toContain('workspace:/Renamed.md'); expect(preview.text).not.toContain('workspace:/Target.md');
    await f.decide('accept');
    expect(collectMarkdownDocumentReferences(f.store.getDocument(documentId))).toEqual(original);
    expect(listDocumentBacklinks(f.db, replacement)).toEqual([]);
    expect(f.read().text).toContain('changed'); expect(f.store.getPendingRevisions(documentId)).toEqual([]);
  });
  it('requires a delivered read and rejects stale observed paths without creating pending rows', async () => {
    const f = await source(); const before = f.read(false);
    await expect(f.writer.write({ identity: f.identity, operation: 'write', content: before.text + ' changed' })).rejects.toMatchObject({ code: 'reference_read_required' });
    f.read();
    f.db.prepare('UPDATE workspace_nodes SET name = ? WHERE id = ?').run('Renamed.md', f.targetId);
    f.workspace.createDocument(f.projectId, 'Target.md', null, 'document');
    await expect(f.writer.write({ identity: f.identity, operation: 'write', content: before.text + ' changed' })).rejects.toMatchObject({ code: 'reference_path_changed' });
    expect(f.store.getPendingRevisions(f.identity.documentId)).toEqual([]);
    const fresh = f.read(); await f.writer.write({ identity: f.identity, operation: 'write', content: fresh.text + ' current' });
    await f.decide('accept'); expect(f.read().text).toContain('current');
  });
  it('keeps invalid references through trusted stored versions, rejects forged appearances, and filters cross-project backlinks', async () => {
    const f = await source(); const id = f.identity.documentId; const original = f.store.getDocument(id);
    const otherProject = createProjectLifecycle(f.db).create({ name: 'Other' });
    f.db.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run(otherProject, f.targetId);
    expect(listDocumentBacklinks(f.db, f.targetId)).toEqual([]);
    f.read(); await expect(f.writer.write({ identity: f.identity, operation: 'write', content: 'Replace all' })).rejects.toMatchObject({ code: 'reference_projection_lossy' });
    f.store.updateDocument(id, { ...original, content: original.content.map(root => ({ ...root, content: [{ type: 'baseBlock', attrs: { id: 'block-12345678' }, content: [] }] })) });
    f.store.updateDocument(id, original);
    expect(collectMarkdownDocumentReferences(f.store.getDocument(id))).toHaveLength(1);
    const forged = JSON.stringify(original).replace(collectMarkdownDocumentReferences(original)[0].referenceId, 'forged-appearance');
    expect(() => f.store.updateDocument(id, JSON.parse(forged))).toThrow('outside_project');
    expect(f.store.getDocument(id)).toEqual(original);
  });
  it('rolls back pending references with Host result failure and removes a proposed reference on rejection', async () => {
    const f = await source(); const before = f.read();
    const second = f.workspace.createDocument(f.projectId, 'Second.md', null, 'document');
    const content = before.text + '\n\n[Second.md](workspace:/Second.md)';
    const writer = createWorkspaceDocumentFileWriteProviderResolver({ db: f.db, context, resultCommit: { prepare() {}, commit() { throw new Error('receipt failed'); } } })('document');
    if (!writer) throw new Error('Writer missing');
    await expect(writer.write({ identity: f.identity, operation: 'write', content })).rejects.toThrow('receipt failed');
    expect(f.store.getPendingRevisions(f.identity.documentId)).toEqual([]); expect(listDocumentBacklinks(f.db, second)).toEqual([]);
    await f.writer.write({ identity: f.identity, operation: 'write', content });
    expect(listDocumentBacklinks(f.db, second)).toHaveLength(1);
    await f.decide('reject'); expect(listDocumentBacklinks(f.db, second)).toEqual([]); expect(f.read().text).toBe(before.text);
  });
  it('keeps distinct appearance IDs when two pending paragraphs have identical Markdown', async () => {
    const f = await source(); const before = f.read();
    await f.writer.write({ identity: f.identity, operation: 'write', content: before.text + '\n\n[Target.md](workspace:/Target.md)\n\n[Target.md](workspace:/Target.md)' });
    await f.decide('accept');
    const references = collectMarkdownDocumentReferences(f.store.getDocument(f.identity.documentId));
    expect(references).toHaveLength(3); expect(new Set(references.map(reference => reference.referenceId)).size).toBe(3);
  });

  it('preserves reference identities when a partial decision serializes the current renamed path', async () => {
    const f = await source(); const id = f.identity.documentId; const original = collectMarkdownDocumentReferences(f.store.getDocument(id));
    await f.writer.write({ identity: f.identity, operation: 'write', content: f.read().text + ' changed' });
    f.db.prepare('UPDATE workspace_nodes SET name = ? WHERE id = ?').run('Renamed.md', f.targetId);
    const pending = f.store.getPendingRevisions(id)[0];
    await new PendingRevisionApplyService(f.store).commitEditorRevision({ documentId: id, expectedVersionNumber: f.store.getLatestVersion(id)!.version_number, expectedPending: [{ id: pending.id, revision: pending.revision }], baseline: f.store.getDocument(id), decision: { mode: 'resolve', blockId: pending.target_block_id, remainingMarkdown: 'See [Renamed.md](workspace:/Renamed.md) remaining' } });
    expect(f.read().text).toContain('workspace:/Renamed.md');
    await f.decide('accept'); expect(collectMarkdownDocumentReferences(f.store.getDocument(id))).toEqual(original);
    expect(f.read().text).toContain('remaining');
  });
  it('drops the removed appearance from a remaining proposal and rejects lossy partial rewriting', async () => {
    const f = await source(); const id = f.identity.documentId;
    await f.writer.write({ identity: f.identity, operation: 'write', content: f.read().text + ' changed' });
    const pending = f.store.getPendingRevisions(id)[0];
    const original = f.store.getDocument(id);
    const other = createProjectLifecycle(f.db).create({ name: 'Partial outside' });
    f.db.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run(other, f.targetId);
    await expect(new PendingRevisionApplyService(f.store).commitEditorRevision({ documentId: id, expectedVersionNumber: f.store.getLatestVersion(id)!.version_number, expectedPending: [{ id: pending.id, revision: pending.revision }], baseline: original, decision: { mode: 'resolve', blockId: pending.target_block_id, remainingMarkdown: 'Replacement' } })).rejects.toThrow('整块接受或拒绝');
    f.db.prepare('UPDATE workspace_nodes SET project_id = ? WHERE id = ?').run(f.projectId, f.targetId);
    const baseline = { ...original, content: original.content.map(root => ({ ...root, content: root.content?.map(block => ({ ...block, content: [{ type: 'text', text: 'See' }] })) })) };
    await new PendingRevisionApplyService(f.store).commitEditorRevision({ documentId: id, expectedVersionNumber: f.store.getLatestVersion(id)!.version_number, expectedPending: [{ id: pending.id, revision: pending.revision }], baseline, decision: { mode: 'resolve', blockId: pending.target_block_id, remainingMarkdown: 'See remaining' } });
    expect(listDocumentBacklinks(f.db, f.targetId)).toEqual([]);
    await f.decide('accept'); expect(collectMarkdownDocumentReferences(f.store.getDocument(id))).toEqual([]);
  });

});

it('registers only the actual read_file page and rejects a stale delivered path before pending write', async () => {
  const f = await source(); const id = f.identity.documentId;
  const args = WorkspaceReadFileArgsSchema.parse({ locator: 'workspace:/source.md', view: 'text' });
  const output = await readFileForTool({ args, rawArgs: args, context: { ...context, databaseService: database, workspaceService: f.workspace, workspaceProjectId: f.projectId } });
  expect(output).not.toContain('referenceId'); expect(output).not.toContain(f.targetId);
  const body = f.read(false);
  f.db.prepare('UPDATE workspace_nodes SET name = ? WHERE id = ?').run('Moved.md', f.targetId);
  f.workspace.createDocument(f.projectId, 'Target.md', null, 'document');
  await expect(f.writer.write({ identity: f.identity, operation: 'write', content: body.text + ' stale' })).rejects.toMatchObject({ code: 'reference_path_changed' });
  expect(f.store.getPendingRevisions(id)).toEqual([]);
});
it('does not expose Host document reference metadata in DocumentView tool output', async () => {
  const f = await source();
  const args = WorkspaceReadFileArgsSchema.parse({ locator: 'workspace:/source.md', view: 'document' });
  const output = await readFileForTool({ args, rawArgs: args, context: { ...context, databaseService: database, workspaceService: f.workspace, workspaceProjectId: f.projectId } });
  expect(output).not.toContain('referenceId'); expect(output).not.toContain('documentReferences'); expect(output).not.toContain(f.targetId);
  await f.writer.write({ identity: f.identity, operation: 'write', content: f.read(false).text + ' updated' });
  expect(f.store.getPendingRevisions(f.identity.documentId)).toHaveLength(1);
});
