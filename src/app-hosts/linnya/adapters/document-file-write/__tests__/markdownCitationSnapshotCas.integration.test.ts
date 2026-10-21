import { EventEmitter, once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginToolContext } from '@linnya/plugin-host-contract/backend/toolRuntime';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import {
  admitDocumentCitations,
  attachCitationRefAllocator,
  attachCitationSourceResolver,
  createCitationRefAllocator,
  type WebCitationSource,
} from 'src/domains/citation';
import {
  createMarkdownReadDatabase,
  MarkdownDocumentService,
  parsePendingMetadata,
  readMarkdownVfsContent,
  type ProseMirrorJsonNode,
} from 'src/domains/markdown';
import { SQLiteEventStore } from '../../persistence/event-store/sqlite.implementation';
import { SqliteCitationRefClaimStore } from '../../persistence/citation-ref-claims/sqliteCitationRefClaimStore';
import { createWorkspaceDocumentFileCreateProviderResolver } from '../../document-file-create/createWorkspaceDocumentFileCreateProviderResolver';
import { createWorkspaceDocumentFileWriteProviderResolver } from '../createWorkspaceDocumentFileWriteProviderResolver';
import type { WorkspaceDocumentFileIdentity } from 'src/features/workspace/document-file-write/definitions/workspaceDocumentFileWrite';

const conversationId = 'citation-snapshot-cas';
let database: DatabaseService;
let documents: MarkdownDocumentService;
let context: PluginToolContext;
let identity: WorkspaceDocumentFileIdentity;
let source: WebCitationSource;
let external: WebCitationSource;

function readCurrentText(): string {
  const read = readMarkdownVfsContent({
    db: createMarkdownReadDatabase(database.getDb()), documentId: identity.documentId,
  });
  if (!read) throw new Error('Expected a persisted Markdown document');
  return read.text;
}

/** 模拟 Editor 保存来源元数据：正文引用 token 和普通文字都保持不变。 */
function replaceCitationMetadata(node: ProseMirrorJsonNode): ProseMirrorJsonNode {
  if (node.type === 'citationNode') {
    return { ...node, attrs: {
      ...node.attrs, sourceId: 'https://example.com/concurrent-source',
      url: 'https://example.com/concurrent-source', authors: ['Concurrent Author'],
      containerTitle: 'Concurrent Journal', snippet: 'A concurrently saved source snapshot.',
    } };
  }
  return { ...node, ...(node.content ? { content: node.content.map(replaceCitationMetadata) } : {}) };
}

function blockedResolver() {
  const barrier = new EventEmitter();
  const entered = once(barrier, 'entered');
  const released = once(barrier, 'released');
  const resolveSources = vi.fn(async (refs: readonly string[]) => {
    expect(refs).toEqual([external.ref]);
    // 在正式 provider 已捕获快照、但尚未获得新增来源时打开可控并发窗口。
    barrier.emit('entered');
    await released;
    return [external];
  });
  attachCitationSourceResolver(context, {
    resolveSources,
    resolveSourcesByUrl: async () => [],
  });
  return { entered, release: () => barrier.emit('released'), resolveSources };
}

function createWriter(commit = vi.fn()) {
  const writer = createWorkspaceDocumentFileWriteProviderResolver({
    db: database.getDb(), context,
    resultCommit: { prepare: vi.fn(), commit },
  })('document');
  if (!writer?.prepareEdit) throw new Error('Expected the formal Markdown edit preparation');
  return { writer, prepareEdit: writer.prepareEdit, commit };
}

beforeEach(async () => {
  database = new DatabaseService(':memory:');
  database.initialize();
  const db = database.getDb();
  const workspaceService = new WorkspaceService(db);
  const projectId = workspaceService.createProject('Citation snapshot CAS');
  documents = new MarkdownDocumentService(db);
  await new SQLiteEventStore(db).ensureConversation(conversationId, [], undefined, 'agent');
  context = { conversationId };
  const allocator = createCitationRefAllocator({
    conversationId, claimStore: new SqliteCitationRefClaimStore(db),
  });
  attachCitationRefAllocator(context, allocator);
  const url = 'https://example.com/original-source';
  const externalUrl = 'https://example.com/external-source';
  const [ref, externalRef] = await allocator.allocate([
    { sourceType: 'web', url }, { sourceType: 'web', url: externalUrl },
  ]);
  if (!ref || !externalRef) throw new Error('Expected allocated source refs');
  source = { sourceType: 'web', ref, url, title: 'Original source', snippet: 'Original snapshot',
    authors: ['Alice', 'Bob'], containerTitle: 'Original Journal' };
  external = { sourceType: 'web', ref: externalRef, url: externalUrl,
    title: 'New source', snippet: 'New acquired snapshot' };
  attachCitationSourceResolver(context, {
    resolveSources: async refs => [source, external].filter(item => refs.includes(item.ref)),
    resolveSourcesByUrl: async () => [],
  });
  const creator = createWorkspaceDocumentFileCreateProviderResolver({
    db, context, workspaceService,
  })('snapshot.md');
  if (!creator) throw new Error('Expected Markdown creation provider');
  const created = await creator.create({
    projectId, parentPath: '/', name: 'snapshot.md', content: `原始正文 [@${source.ref}]。`,
  });
  identity = { documentId: created.documentId, documentName: 'snapshot.md', documentType: 'document',
    projectId, path: '/snapshot.md', inode: `workspace:${created.documentId}` };
});

afterEach(() => database.close());

describe('citation-aware Markdown Host provider snapshot CAS', () => {
  it.each(['edit', 'write'] as const)(
    '%s 在取来源期间发生同正文的 Citation 元数据变化时拒绝，保留并发保存',
    async operation => {
      const { writer, prepareEdit, commit } = createWriter();
      const before = readCurrentText();
      const prepared = await prepareEdit({ identity, currentText: before });
      const barrier = blockedResolver();
      const writing = writer.write({
        identity, operation, content: `${prepared.text} 新增来源 [@${external.ref}]。`,
        ...(operation === 'edit'
          ? { expectedCurrentText: before, expectedSourceKey: prepared.sourceKey, replacedCount: 1 }
          : {}),
      });
      const rejected = expect(writing).rejects.toMatchObject({ code: 'MARKDOWN_FILE_WRITE_CONFLICT' });
      await barrier.entered;
      const original = documents.getDocument(identity.documentId);
      documents.updateDocument(identity.documentId, {
        ...original, content: original.content.map(replaceCitationMetadata),
      });
      expect(readCurrentText()).toBe(before);
      const concurrent = documents.getDocument(identity.documentId);
      const version = documents.getLatestVersion(identity.documentId);
      barrier.release();
      await rejected;
      expect(barrier.resolveSources).toHaveBeenCalledOnce();
      expect(documents.getDocument(identity.documentId)).toEqual(concurrent);
      expect(documents.getLatestVersion(identity.documentId)).toEqual(version);
      expect(documents.getPendingRevisions(identity.documentId)).toEqual([]);
      expect(admitDocumentCitations(concurrent).sources).toEqual([
        expect.objectContaining({ url: 'https://example.com/concurrent-source',
          authors: ['Concurrent Author'], containerTitle: 'Concurrent Journal' }),
      ]);
      expect(commit).not.toHaveBeenCalled();
    },
  );

  it('正文版本及 Pending 文本都未变，仅 Pending 元数据与 revision 改变时拒绝', async () => {
    const { writer, prepareEdit, commit } = createWriter();
    await writer.write({ identity, operation: 'write', content: `待确认正文 [@${source.ref}]。` });
    commit.mockClear();
    const before = readCurrentText();
    const baseline = documents.getDocument(identity.documentId);
    const version = documents.getLatestVersion(identity.documentId);
    const pending = documents.getPendingRevisions(identity.documentId)[0];
    if (!pending) throw new Error('Expected a pending citation-bearing revision');
    const prepared = await prepareEdit({ identity, currentText: before });
    const barrier = blockedResolver();
    const writing = writer.write({
      identity, operation: 'edit', content: `${prepared.text} 新增来源 [@${external.ref}]。`,
      expectedCurrentText: before, expectedSourceKey: prepared.sourceKey, replacedCount: 1,
    });
    const rejected = expect(writing).rejects.toMatchObject({ code: 'MARKDOWN_FILE_WRITE_CONFLICT' });
    await barrier.entered;
    const changed = documents.setPendingRevision(
      identity.documentId, pending.target_block_id, pending.new_markdown, 'user', {
        ...parsePendingMetadata(pending.meta_json),
        citation_hydration: { [source.ref]: {
          sourceType: 'web', url: source.url, title: source.title,
          snippet: 'Concurrent pending source snapshot', authors: ['Pending Author'],
          containerTitle: 'Pending Journal',
        } },
      },
    );
    expect(changed.id).toBe(pending.id);
    expect(changed.revision).toBe(pending.revision + 1);
    expect(changed.new_markdown).toBe(pending.new_markdown);
    expect(readCurrentText()).toBe(before);
    expect(documents.getLatestVersion(identity.documentId)).toEqual(version);
    const concurrentPendings = documents.getPendingRevisions(identity.documentId);
    barrier.release();
    await rejected;
    expect(barrier.resolveSources).toHaveBeenCalledOnce();
    expect(documents.getDocument(identity.documentId)).toEqual(baseline);
    expect(documents.getLatestVersion(identity.documentId)).toEqual(version);
    expect(documents.getPendingRevisions(identity.documentId)).toEqual(concurrentPendings);
    expect(commit).not.toHaveBeenCalled();
  });
});
