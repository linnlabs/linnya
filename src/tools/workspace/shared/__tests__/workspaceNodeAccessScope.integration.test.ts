import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WorkspaceGrepResultSchema,
  WorkspaceListFilesResultSchema,
  WorkspaceReadFileResultSchema,
} from '@app/schemas';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { MarkdownDocumentService } from 'src/domains/markdown';
import { defaultToolRuntimePort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { buildSystemInodeFileId } from 'src/features/workspace/vfs/functions/virtualNodeIds';
import type { ToolContext } from 'src/tools/types';

let database: DatabaseService;
let workspace: WorkspaceService;
let projectId: string;
let context: ToolContext;

beforeEach(() => {
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(database.getDb());
  projectId = workspace.createProject('Node access scope');
  context = {
    ...createToolContextFixture({
      conversationId: 'vfs-node-access',
      turnId: 'vfs-node-access-turn',
    }),
    workspaceProjectId: projectId,
    databaseService: database,
    workspaceService: workspace,
  };
});

afterEach(() => {
  database.close();
  clearPluginRuntimeStateForTests();
});

function createDocument(name: string, paragraphs: readonly string[]): string {
  const id = workspace.createDocument(projectId, name);
  new MarkdownDocumentService(database.getDb()).createDocument(id, {
    type: 'doc',
    content: paragraphs.map((text, index) => ({
      type: 'rootBlock',
      attrs: { id: `${id}-block-${index}` },
      content: [{ type: 'baseBlock', content: [{ type: 'text', text }] }],
    })),
  });
  return id;
}

async function execute(
  toolName: string,
  args: Record<string, unknown>,
  caller = context
): Promise<string> {
  const result = await defaultToolRuntimePort.executeTool(toolName, args, caller);
  if (!result.success || typeof result.result !== 'string') {
    throw new Error(`Expected ${toolName} success: ${JSON.stringify(result)}`);
  }
  return result.result;
}

async function expectDenied(
  toolName: string,
  args: Record<string, unknown>,
  caller: ToolContext
): Promise<void> {
  const result = await defaultToolRuntimePort.executeTool(toolName, args, caller);
  expect(result).toMatchObject({
    success: false,
    errorCode: 'EPERM',
    error: expect.stringContaining('[WORKSPACE_NODE_ACCESS_DENIED]'),
  });
}

describe('Workspace node access scope through registered file tools and real SQLite', () => {
  it.each([true, false])(
    '同项目拒绝节点及其系统别名；索引=%s，合法匹配不被候选预算挤掉',
    async indexed => {
      const peerId = createDocument(
        'a-peer.md',
        Array.from({ length: 80 }, (_, index) => `scope-marker xy peer-secret-${index}`)
      );
      const allowedId = createDocument('z-source.md', ['scope-marker xy admitted-material']);
      if (!indexed) {
        database
          .getDb()
          .exec('DROP TABLE workspace_vfs_search_grams; DROP TABLE workspace_vfs_search_lines;');
      }
      const scoped: ToolContext = {
        ...context,
        resolveWorkspaceNodeAccessScope: () => ({ excludedNodeIds: [peerId] }),
      };
      const peerLocator = 'workspace:/a-peer.md';
      const systemLocator = `workspace:/.linnya/views/by-inode/workspace:${peerId}/content.md`;
      const systemParent = 'workspace:/.linnya/views/by-inode';

      // 普通调用先建立真实 peer 索引；scope 必须适用于已缓存内容。
      const defaultSearch = WorkspaceGrepResultSchema.parse(
        JSON.parse(await execute('grep', { pattern: 'peer-secret' }))
      );
      expect(defaultSearch.data.matches[0]?.inode).toBe(`workspace:${peerId}`);
      const peerIndexBefore = database.getDb().prepare('SELECT total_changes() AS count').get();
      for (const pattern of ['scope-marker', 'xy']) {
        const result = WorkspaceGrepResultSchema.parse(
          JSON.parse(await execute('grep', { pattern, max_results: 1 }, scoped))
        );
        expect(result.data.matches).toHaveLength(1);
        expect(result.data.matches[0]?.inode).toBe(`workspace:${allowedId}`);
        expect(result.observation).not.toContain('peer-secret');
        expect(JSON.stringify(result)).not.toContain(peerId);
        expect(JSON.stringify(result)).not.toContain(peerLocator);
      }
      if (indexed) {
        // scope 不应把隐藏节点当成 stale；预热后两次搜索也不能修改共享索引。
        expect(database.getDb().prepare('SELECT total_changes() AS count').get()).toEqual(
          peerIndexBefore
        );
      }

      const list = WorkspaceListFilesResultSchema.parse(
        JSON.parse(await execute('list_files', { limit: 1 }, scoped))
      );
      expect(list.data.total_count).toBe(1);
      expect(list.data.has_more).toBe(false);
      expect(list.data.entries[0]?.inode).toBe(`workspace:${allowedId}`);
      const aliases = await execute(
        'list_files',
        { locator: systemParent, include_system_nodes: true },
        scoped
      );
      expect(aliases).toContain(allowedId);
      expect(aliases).not.toContain(peerId);
      const folderRead = await execute('read_file', { locator: systemParent }, scoped);
      expect(folderRead).toContain(allowedId);
      expect(folderRead).not.toContain(peerId);

      await execute('grep', { locator: systemParent, pattern: 'peer-secret' });
      const aliasIndexBefore = database.getDb().prepare('SELECT total_changes() AS count').get();
      const scopedAliases = await execute(
        'grep',
        { locator: systemParent, pattern: 'scope-marker', max_results: 1 },
        scoped
      );
      expect(scopedAliases).toContain('admitted-material');
      expect(scopedAliases).not.toContain(peerId);
      if (indexed) {
        expect(database.getDb().prepare('SELECT total_changes() AS count').get()).toEqual(
          aliasIndexBefore
        );
      }
      expect(await execute('grep', { locator: systemParent, pattern: 'peer-secret' })).toContain(
        'peer-secret'
      );

      for (const identity of [
        { locator: peerLocator },
        { inode: `workspace:${peerId}` },
        { locator: systemLocator },
        {
          inode: buildSystemInodeFileId({
            projectId,
            workspaceNodeId: peerId,
            viewKind: 'document_content',
          }),
        },
      ]) {
        await expectDenied('read_file', identity, scoped);
        await expectDenied('read_file', { ...identity, view: 'document' }, scoped);
        await expectDenied('grep', { ...identity, pattern: 'peer-secret' }, scoped);
        await expectDenied('list_files', { ...identity, include_system_nodes: true }, scoped);
      }
      for (const view of ['text', 'document']) {
        const allowed = WorkspaceReadFileResultSchema.parse(
          JSON.parse(await execute('read_file', { inode: `workspace:${allowedId}`, view }, scoped))
        );
        expect(allowed.observation).toContain('admitted-material');
        expect(await execute('read_file', { inode: `workspace:${peerId}`, view })).toContain(
          'peer-secret'
        );
      }
      expect(await execute('read_file', { locator: systemLocator })).toContain('peer-secret');
      expect(await execute('grep', { pattern: 'peer-secret' })).toContain(peerId);
    }
  );

  it('每次调用重新取得范围，重命名/移动不解禁，拒绝写入不创建节点或pending', async () => {
    const peerId = createDocument('peer.md', ['peer-secret']);
    const allowedId = createDocument('source.md', ['admitted-material']);
    let excludedNodeIds: readonly string[] = [];
    const scoped: ToolContext = {
      ...context,
      resolveWorkspaceNodeAccessScope: () => ({ excludedNodeIds }),
    };
    expect(await execute('read_file', { inode: `workspace:${peerId}` }, scoped)).toContain(
      'peer-secret'
    );
    // 模拟同一 caller 运行期间新的业务事实生效，不能冻结在上下文创建时。
    excludedNodeIds = [peerId];
    await expectDenied('read_file', { inode: `workspace:${peerId}` }, scoped);
    const folderId = workspace.createFolder(projectId, 'Moved');
    workspace.renameNode(peerId, 'renamed.md');
    workspace.moveNode(peerId, folderId);
    const movedLocator = 'workspace:/Moved/renamed.md';
    await expectDenied('read_file', { locator: movedLocator }, scoped);
    await expectDenied('read_file', { inode: `workspace:${peerId}` }, scoped);
    const folder = WorkspaceListFilesResultSchema.parse(
      JSON.parse(await execute('list_files', { locator: 'workspace:/Moved' }, scoped))
    );
    expect(folder.data.entries).toEqual([]);

    const before = database.getDb().prepare('SELECT total_changes() AS count').get();
    for (const identity of [{ locator: movedLocator }, { inode: `workspace:${peerId}` }]) {
      await expectDenied('write_file', { ...identity, content: 'overwrite-attempt' }, scoped);
      await expectDenied(
        'edit_file',
        { ...identity, old_string: 'peer-secret', new_string: 'overwrite-attempt' },
        scoped
      );
    }
    expect(database.getDb().prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect(await execute('read_file', { locator: movedLocator })).toContain('peer-secret');
    expect(await execute('read_file', { inode: `workspace:${allowedId}` }, scoped)).toContain(
      'admitted-material'
    );
  });
});
