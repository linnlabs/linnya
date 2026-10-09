import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createToolOutputEvent, routeRuntimeEvent, RunIdSchema,
} from '@linnlabs/linnkit/contracts';
import { WebSearchResultSchema, WorkspaceReadFileResultSchema } from '@app/schemas';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import {
  attachCitationRefAllocator, attachCitationSequence, createCitationRefAllocator,
} from 'src/domains/citation';
import { MarkdownDocumentService } from 'src/domains/markdown';
import { ReadFileTool } from 'src/tools/workspace/read_file/ReadFileTool';
import type { ToolContext } from 'src/tools/types';
import { SQLiteEventStore, type RunSession } from '../persistence/event-store';
import { SqliteCitationRefClaimStore } from '../persistence/citation-ref-claims/sqliteCitationRefClaimStore';
import {
  createWorkspaceResearchDocumentPort, RESEARCH_DOCUMENT_SOURCE_MAX_CHARS,
} from './index';
import type { ResearchDocumentBinding, ResearchDocumentSaveRequest } from '../../application/research/definitions/researchDocumentPort';

let database: DatabaseService;
let workspace: WorkspaceService;
let store: SQLiteEventStore;
let projectId: string;
let author: RunSession;
let reviewer: RunSession;

beforeEach(async () => {
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(database.getDb());
  store = new SQLiteEventStore(database.getDb());
  projectId = workspace.createProject('Research fixture');
  await store.ensureConversation('author', [], projectId, 'agent');
  await store.ensureConversation('reviewer', [], projectId, 'agent');
  author = await store.beginRunSession('author', 'author-run', { kind: 'agent' });
  reviewer = await store.beginRunSession('reviewer', 'reviewer-run', { kind: 'agent' });
});

afterEach(() => {
  database.close();
  vi.restoreAllMocks();
});

function port() {
  return createWorkspaceResearchDocumentPort({ db: database.getDb(), workspaceService: workspace, eventStore: store });
}

function saveRequest(path: string, text: string, session = author): ResearchDocumentSaveRequest {
  return {
    projectId, conversationId: session.conversationId, sourceRunId: session.runId, path, text,
    receipt: {
      prepare: vi.fn(),
      commit: vi.fn(() => expect(database.getDb().inTransaction).toBe(true)),
    },
  };
}

async function appendToolResult(session: RunSession, name: string, data: unknown, observation: string) {
  const event = createToolOutputEvent(`event-${name}-${session.runId}`, session.conversationId, 'turn-1', name, `call-${name}-${session.runId}`, {
    status: 'success', data, observation,
  });
  await store.appendEventToRun(session, routeRuntimeEvent(event, {
    run_id: RunIdSchema.parse(session.runId), lane: 'foreground', visibility: 'conversation',
  }));
}

async function source(session = author) {
  const result = WebSearchResultSchema.parse({
    data: {
      query: 'fixture', resultCount: 1,
      citations: { query: 'fixture', searchMode: 'web', citations: [{
        ref: 'Abc234', index: 1, sourceType: 'web', url: 'https://example.com/source',
        docTitle: 'Source', snippet: 'Persisted evidence snapshot',
      }] },
      evidence_store: { bundle_id: '0123456789abcdef' }, cacheStatus: 'miss',
    },
    observation: 'Synthetic source fixture',
  });
  await appendToolResult(session, 'web_search', result.data, result.observation);
}

describe('Research document handoff with real Workspace, Markdown and SQLite', () => {
  it('完整读取长稿与pending，用户改稿改变版本而重命名保持稳定inode/version', async () => {
    const text = `# Article\n\n${'Long research paragraph. '.repeat(6000)}\n\nOriginal ending.`;
    const created = await port().save(saveRequest('workspace:/article.md', text));
    expect(created.text.length).toBeGreaterThan(120000);
    expect(created.text).toContain('Original ending.');
    const documentId = created.inode.slice('workspace:'.length);
    const documents = new MarkdownDocumentService(database.getDb());
    const document = documents.getDocument(documentId);
    const lastBlock = document.content?.[document.content.length - 1];
    const blockId = lastBlock?.attrs?.id;
    if (typeof blockId !== 'string') throw new Error('Fixture root block missing');
    documents.setPendingRevision(documentId, blockId, 'User changed ending.', 'user');
    const current = await port().read({ projectId, inode: created.inode });
    expect(current.text).toContain('User changed ending.');
    expect(current.text).not.toContain('Original ending.');
    expect(current.sha256).not.toBe(created.sha256);
    workspace.renameNode(documentId, 'renamed.md');
    const renamed = await port().read({ projectId, inode: created.inode });
    expect(renamed.sha256).toBe(current.sha256);
    expect(renamed.locator).toBe('workspace:/renamed.md');
  });

  it('跨会话必须经正式read_file重绑引用；保存review不改原稿或canonical快照', async () => {
    await source();
    const original = await port().save(saveRequest('workspace:/article.md', '# Article\n\nFact [@Abc234]'));
    await expect(port().save(saveRequest('workspace:/unbound.md', 'Review [@Abc234]', reviewer)))
      .rejects.toMatchObject({ code: 'RESEARCH_DOCUMENT_CITATION_INVALID' });
    const context: ToolContext = {
      databaseService: database, workspaceService: workspace, workspaceProjectId: projectId,
      conversationId: reviewer.conversationId, runId: RunIdSchema.parse(reviewer.runId),
    };
    attachCitationSequence(context, { offset: 0 });
    attachCitationRefAllocator(context, createCitationRefAllocator({
      conversationId: reviewer.conversationId,
      claimStore: new SqliteCitationRefClaimStore(database.getDb()),
    }));
    const read = WorkspaceReadFileResultSchema.parse(JSON.parse(await new ReadFileTool().run({ inode: original.inode }, context)));
    if (read.data.source_kind !== 'workspace_vfs') throw new Error('Expected Workspace read');
    const ref = read.data.citations?.citations[0]?.ref;
    if (!ref) throw new Error('Formal read did not bind citation');
    expect(ref).not.toBe('Abc234');
    await appendToolResult(reviewer, 'read_file', read.data, read.observation);
    const review = await port().save(saveRequest('workspace:/review.md', `# Review\n\nSupported [@${ref}]`, reviewer));
    expect(review.text).toContain(`[@${ref}]`);
    const reread = await port().read({ projectId, inode: original.inode });
    expect(reread.sha256).toBe(original.sha256);
    expect(reread.citationSha256).toBe(original.citationSha256);
    expect(workspace.getChildNodes(null, projectId).map(node => node.name).sort()).toEqual(['article.md', 'review.md']);
  });

  it('同会话另一run的ref不能借用，错误conversation/run归属也不能保存', async () => {
    await source();
    const sibling = await store.beginRunSession('author', 'sibling-run', { kind: 'agent' });
    await expect(port().save(saveRequest('workspace:/wrong-scope.md', 'Wrong [@Abc234]', sibling)))
      .rejects.toMatchObject({ code: 'RESEARCH_DOCUMENT_CITATION_INVALID' });
    await expect(port().save({ ...saveRequest('workspace:/wrong-owner.md', 'Wrong'), conversationId: 'reviewer' })).rejects.toThrow();
    expect(workspace.getChildNodes(null, projectId)).toEqual([]);
  });

  it('正文未变但持久化引用快照变化时仍使旧评审版本过期', async () => {
    await source();
    const original = await port().save(saveRequest('workspace:/article.md', 'Fact [@Abc234]'));
    const documents = new MarkdownDocumentService(database.getDb());
    const id = original.inode.slice('workspace:'.length);
    const persisted = JSON.stringify(documents.getDocument(id));
    expect(persisted).toContain('Persisted evidence snapshot');
    documents.saveNewVersion(id, persisted.replace('Persisted evidence snapshot', 'User corrected source snapshot'));
    const changed = await port().read({ projectId, inode: original.inode });
    expect(changed.text).toBe(original.text);
    expect(changed.citationSha256).not.toBe(original.citationSha256);
    expect(changed.sha256).not.toBe(original.sha256);
  });

  it('create-only拒绝错写原稿；receipt失败与新稿原子回滚，合法评审保留独立绑定', async () => {
    const original = await port().save(saveRequest('workspace:/article.md', '# Original'));
    await expect(port().save(saveRequest('workspace:/article.md', '# Reviewer overwrite', reviewer))).rejects.toThrow();
    const failed = saveRequest('workspace:/review.md', '# Review', reviewer);
    await expect(port().save({ ...failed, receipt: {
      prepare: failed.receipt.prepare,
      commit: () => { throw new Error('receipt commit failed'); },
    } })).rejects.toThrow('receipt commit failed');
    expect(workspace.getChildNodes(null, projectId).map(node => node.name)).toEqual(['article.md']);
    let committed: ResearchDocumentBinding | undefined;
    const successful = saveRequest('workspace:/review.md', '# Review', reviewer);
    const review = await port().save({ ...successful, receipt: {
      prepare: successful.receipt.prepare,
      commit: binding => { expect(database.getDb().inTransaction).toBe(true); committed = binding; },
    } });
    expect(committed).toMatchObject({ inode: review.inode, sha256: review.sha256, citationSha256: review.citationSha256 });
    expect(committed).not.toHaveProperty('text');
    expect((await port().read({ projectId, inode: original.inode })).sha256).toBe(original.sha256);
  });

  it('拒绝缺稿、空稿和真实VFS截断，不接纳部分正文', async () => {
    await expect(port().read({ projectId, locator: 'workspace:/missing.md' })).rejects.toMatchObject({ code: 'RESEARCH_DOCUMENT_MISSING' });
    await expect(port().save(saveRequest('workspace:/empty.md', '  '))).rejects.toMatchObject({ code: 'RESEARCH_DOCUMENT_INVALID' });
    const id = workspace.createDocument(projectId, 'oversized.md');
    new MarkdownDocumentService(database.getDb()).createDocument(id, { type: 'doc', content: [{
      type: 'rootBlock', attrs: { id: 'oversized-root' }, content: [{
        type: 'baseBlock', attrs: { id: 'oversized-paragraph' }, content: [{ type: 'text', text: 'x'.repeat(RESEARCH_DOCUMENT_SOURCE_MAX_CHARS + 1) }],
      }],
    }] });
    await expect(port().read({ projectId, inode: `workspace:${id}` })).rejects.toMatchObject({ code: 'RESEARCH_DOCUMENT_TRUNCATED' });
  });
});
