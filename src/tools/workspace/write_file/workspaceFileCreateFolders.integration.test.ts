import { createProjectLifecycle } from 'src/domains/projects';
import { ToolNode, type EngineState } from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema, ToolCallIdSchema, routeRuntimeEvent } from '@linnlabs/linnkit/contracts';
import { createToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WorkspaceListFilesResultSchema,
  WorkspaceReadFileResultSchema,
  WorkspaceWriteFileResultSchema,
  type WorkspaceMutationEvent,
} from '@app/schemas';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { attachCitationSourceResolver } from 'src/domains/citation';
import {
  registerDocumentTypeBackendHook,
  unregisterDocumentTypeBackendHook,
  type DocumentTypeBackendHook,
} from 'src/plugin-sdk/backend/documentTypeBackendHook';
import type { ToolContext } from '../../types';
import { WriteFileTool } from './WriteFileTool';
import { ReadFileTool } from '../read_file/ReadFileTool';
import { ListFilesTool } from '../list_files/ListFilesTool';

let database: DatabaseService;
let projectId: string;
let workspace: WorkspaceService;
let context: ToolContext;
let events: WorkspaceMutationEvent[];
const pluginType = 'folder_create_fixture';
const write = new WriteFileTool();

beforeEach(() => {
  database = new DatabaseService(':memory:');
  database.initialize();
  events = [];
  const publisher = { publish: (event: WorkspaceMutationEvent) => events.push(event) };
  workspace = new WorkspaceService(database.getDb(), { mutationPublisher: publisher });
  projectId = createProjectLifecycle(database.getDb()).create({ name: 'Automatic folders' });
  context = {
    databaseService: database,
    workspaceProjectId: projectId,
    conversationId: 'create-folders',
    workspaceService: workspace,
    workspaceMutationPublisher: publisher,
  };
  attachCitationSourceResolver(context, {
    resolveSources: async () => [],
    resolveSourcesByUrl: async () => [],
  });
});

afterEach(async () => {
  // mutation publisher 在下一 macrotask 核对事务的最终事实。
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  unregisterDocumentTypeBackendHook(pluginType);
  database.close();
});

async function create(locator: string, content = '# Report\n\nA complete report.') {
  return WorkspaceWriteFileResultSchema.parse(
    JSON.parse(await write.run({ locator, content }, context))
  );
}

function registerPlugin(
  createDocument: NonNullable<DocumentTypeBackendHook['createDocument']>,
  enabled = true
) {
  registerDocumentTypeBackendHook({
    docType: pluginType,
    displayName: 'Folder fixture',
    fileExtension: '.folder-fixture',
    isEnabled: () => enabled,
    createDocument,
  });
}

function rows() {
  return database
    .getDb()
    .prepare(
      'SELECT name, type, parent_id FROM workspace_nodes WHERE deleted_at IS NULL ORDER BY name'
    )
    .all();
}

describe('write_file creates project parent folders', () => {
  it('正式 ToolNode 接纳后输出已创建目录；插件失败仍投影 error 并保留目录事实', async () => {
    registerPlugin(() => {
      throw new Error('fixture rejected');
    });
    const runtime = createToolRuntimeHarness([write]);
    const node = new ToolNode({
      toolRuntime: runtime.toolRuntime,
      observationPreview: {
        truncateObservation: async ({ text }) => ({ truncated: false, preview: text }),
      },
    });
    const state = (callId: string, locator: string): EngineState => ({
      nodeId: 'tool',
      local: {
        conversationId: 'create-folders',
        turnId: 'folder-turn',
        pendingToolCalls: [
          {
            id: ToolCallIdSchema.parse(callId),
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({ locator, content: 'A report' }),
            },
          },
        ],
        toolContext: context,
        runtimeEventSink: event =>
          routeRuntimeEvent(event, {
            run_id: RunIdSchema.parse(`run-${callId}`),
            lane: 'foreground',
            visibility: 'conversation',
          }),
      },
    });
    try {
      const success = await node.run(state('new-folder', 'workspace:/formal/nested/report.md'));
      const output = success.events?.find(event => event.type === 'tool_output');
      expect(output).toMatchObject({
        status: 'success',
        data: {
          created_folders: [
            { locator: 'workspace:/formal' },
            { locator: 'workspace:/formal/nested' },
          ],
        },
      });
      const failure = await node.run(
        state('failed-folder', 'workspace:/plugin/failure.folder-fixture')
      );
      const failedOutput = failure.events?.find(event => event.type === 'tool_output');
      expect(failedOutput).toMatchObject({
        status: 'error',
        error: expect.stringContaining('created_folders:'),
      });
      expect(failedOutput).toMatchObject({
        observation: expect.stringContaining('workspace:/plugin'),
      });
    } finally {
      runtime.restore();
    }
  });

  it('一次创建嵌套目录与 Markdown，read/list 使用真实路径，后续同目录写入不重复创建', async () => {
    const result = await create('workspace:/research/reviews/source.md');
    expect(result.data.created_folders?.map(folder => folder.locator)).toEqual([
      'workspace:/research',
      'workspace:/research/reviews',
    ]);
    for (const folder of result.data.created_folders ?? []) {
      expect(result.observation).toContain(folder.locator);
      expect(result.observation).toContain(folder.inode);
    }
    const read = WorkspaceReadFileResultSchema.parse(
      JSON.parse(await new ReadFileTool().run({ locator: result.data.locator }, context))
    );
    expect(read.observation).toContain('A complete report.');
    const list = WorkspaceListFilesResultSchema.parse(
      JSON.parse(await new ListFilesTool().run({ locator: 'workspace:/research' }, context))
    );
    expect(list.data.entries.map(entry => entry.locator)).toContain('workspace:/research/reviews');
    const next = await create('workspace:/research/reviews/argument.md');
    expect(next.data.created_folders).toEqual([]);
    expect((await create('workspace:/research/reviews/source.md', 'Updated')).data).toMatchObject({
      operation: 'update',
      created_folders: [],
    });
    expect(rows()).toHaveLength(4);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(events).toHaveLength(5); // 四个新节点 + 已有正文更新。
  });

  it('部分父路径存在时只列新增层，不跨项目复用同名目录', async () => {
    const existing = workspace.createFolder(projectId, 'research');
    const otherProject = createProjectLifecycle(database.getDb()).create({ name: 'Other' });
    workspace.createFolder(otherProject, 'research');
    const result = await create('workspace:/research/new/final.md');
    expect(result.data.created_folders?.map(folder => folder.locator)).toEqual([
      'workspace:/research/new',
    ]);
    const created = result.data.created_folders?.[0];
    if (!created) throw new Error('Expected created folder');
    expect(workspace.getNode(created.inode.slice('workspace:'.length))?.parent_id).toBe(existing);
  });

  it('引用 admission 失败没有任何目录、文档或 mutation 事件', async () => {
    await expect(
      create('workspace:/new/nested/rejected.md', 'Unresolved [@Abc234]')
    ).rejects.toThrow();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(rows()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('正文版本提交失败会回滚新目录与节点，不广播幽灵目录', async () => {
    database
      .getDb()
      .exec(
        `CREATE TRIGGER reject_version BEFORE INSERT ON document_versions BEGIN SELECT RAISE(ABORT, 'fixture version rejected'); END;`
      );
    await expect(create('workspace:/new/nested/rejected.md')).rejects.toThrow(
      'fixture version rejected'
    );
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(rows()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('提交回执与目录及正文同事务；回执拒绝时全部回滚', async () => {
    context.parentToolCallId = ToolCallIdSchema.parse('receipt-call');
    context.toolResultReceipts = {
      prepare: () => undefined,
      commit: () => {
        throw new Error('fixture receipt rejected');
      },
      returned: () => undefined,
    };
    await expect(create('workspace:/new/nested/rejected.md')).rejects.toThrow(
      'fixture receipt rejected'
    );
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(rows()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('并发创建相同父路径只创建一次目录，文件名冲突不覆盖已有文档', async () => {
    const results = await Promise.all([
      create('workspace:/shared/a.md'),
      create('workspace:/shared/b.md'),
    ]);
    expect(
      results.reduce((total, item) => total + (item.data.created_folders?.length ?? 0), 0)
    ).toBe(1);
    expect(rows()).toHaveLength(3);
    const outcomes = await Promise.allSettled([
      create('workspace:/race/same.md', 'first'),
      create('workspace:/race/same.md', 'second'),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(rows()).toHaveLength(5);
  });

  it('文件、隐藏节点与系统虚拟视图都不能成为新建目录的父级', async () => {
    await create('workspace:/existing.md');
    await expect(create('workspace:/existing.md/nested/new.md')).rejects.toThrow(
      '只能在可写的 Workspace 文件夹'
    );
    await expect(create('workspace:/.linnya/views/new.md')).rejects.toThrow('虚拟系统目录');
    const hidden = workspace.createFolder(projectId, 'hidden');
    database
      .getDb()
      .prepare('UPDATE workspace_nodes SET tags = ? WHERE id = ?')
      .run(JSON.stringify({ linnyaRole: 'resource_library' }), hidden);
    await expect(create('workspace:/hidden/new.md')).rejects.toThrow(
      '只能在可写的 Workspace 文件夹'
    );
    expect(rows()).toHaveLength(2);
  });

  it('不支持或已停用的格式不会预先创建目录', async () => {
    await expect(create('workspace:/unsupported/new.unknown-format')).rejects.toThrow(
      '不支持的文件格式'
    );
    registerPlugin(() => {
      throw new Error('Disabled hook must not run');
    }, false);
    await expect(create('workspace:/disabled/new.folder-fixture')).rejects.toThrow('未启用');
    expect(rows()).toEqual([]);
  });

  it('插件得到真实目录身份，异步 hook 不被包进同步 SQLite 事务', async () => {
    registerPlugin(async request => {
      expect(database.getDb().inTransaction).toBe(false);
      expect(workspace.getNode(request.parentId ?? '')).toMatchObject({
        type: 'folder',
        name: 'plugin',
      });
      await Promise.resolve();
      return {
        documentId: workspace.createDocument(
          request.projectId,
          request.name,
          request.parentId,
          pluginType
        ),
      };
    });
    const result = await create('workspace:/nested/plugin/report.folder-fixture');
    expect(result.data.created_folders).toHaveLength(2);
    expect(result.data.locator).toBe('workspace:/nested/plugin/report.folder-fixture');
    expect(result.data.text_metrics).toBeUndefined();
    expect(result.observation).not.toContain('当前全文（含待确认修订）');
  });

  it('插件失败保持错误终态且披露已创建目录，不回删被并发调用复用的目录', async () => {
    let enterHook: () => void = () => undefined;
    let releaseHook: () => void = () => undefined;
    const entered = new Promise<void>(resolve => {
      enterHook = resolve;
    });
    const release = new Promise<void>(resolve => {
      releaseHook = resolve;
    });
    registerPlugin(async () => {
      enterHook();
      await release;
      throw new Error('fixture plugin rejected');
    });
    const pending = create('workspace:/shared/plugin/report.folder-fixture');
    await entered;
    const sibling = await create('workspace:/shared/plugin/keep.md');
    expect(sibling.data.created_folders).toEqual([]);
    releaseHook();
    await expect(pending).rejects.toThrow(
      /fixture plugin rejected[\s\S]*created_folders:.*workspace:\/shared\/plugin/
    );
    expect(rows()).toHaveLength(3);
    const read = await new ReadFileTool().run({ locator: sibling.data.locator }, context);
    expect(read).toContain('A complete report.');
  });

  it.each([
    { name: 'AbortError', code: undefined },
    { name: 'Error', code: 'RUN_RECOVERY_BLOCKED' },
    { name: 'Error', code: 'RUN_PAUSE_REQUESTED' },
  ])('插件中断保留 $name / $code 信号；目录回执按 JSON 编码', async signal => {
    const original = Object.assign(new Error('fixture interrupted'), signal);
    registerPlugin(() => {
      throw original;
    });
    const folderName = 'quoted "folder"';
    try {
      await create(`workspace:/${folderName}/report.folder-fixture`);
      throw new Error('Expected plugin interruption');
    } catch (error) {
      expect(error).toMatchObject({ name: signal.name, cause: original });
      if (signal.code) expect(error).toMatchObject({ code: signal.code });
      if (!(error instanceof Error)) throw error;
      const receipt = error.message.split('\ncreated_folders: ')[1];
      expect(JSON.parse(receipt)).toEqual([
        { locator: `workspace:/${folderName}`, inode: expect.stringMatching(/^workspace:/) },
      ]);
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(rows()).toHaveLength(1);
    expect(events).toHaveLength(1);
  });
});
