/**
 * @file scripts/diagnostics/workspace/workspace-explorer.ts
 *
 * @brief Workspace 数据探索工具（命令行）
 *
 * @description
 * 这个脚本更偏向「浏览器」，方便从命令行直接查看 Workspace 的项目、节点树、
 * 以及文档底层 JSON 内容，用于快速排查问题、验证 Workspace 读写逻辑。
 *
 * 使用方式（在项目根目录）：
 *  - 列出所有项目：
 *    pnpm run test:workspace-explorer -- list-projects
 *
 *  - 列出某项目 / 某文件夹下的节点：
 *    pnpm run test:workspace-explorer -- list-nodes <projectId> [parentNodeId]
 *
 *  - 查看最近打开的文档：
 *    pnpm run test:workspace-explorer -- recent-docs [limit]
 *
 *  - 查看文档 JSON 内容（自动判断 markdown / mindmap）：
 *    pnpm run test:workspace-explorer -- show-doc-json <documentId>
 */

import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  RecentDocumentInfo,
  WorkspaceNode,
  WorkspaceService,
} from 'src/electron-main/services/workspace/workspace';
import type {
  DocumentTypeBackendReadDatabase,
  DocumentTypeBackendStatement,
} from '@plugin/backend/documentTypeBackendHook';

const processArgs = process.argv.slice(2);
if (!processArgs.includes('--prod') && process.env.LINNYA_DEV_MODE === undefined) {
  process.env.LINNYA_DEV_MODE = 'true';
}

type ExplorerContext = {
  database: Database.Database;
  workspaceService: WorkspaceService;
};

function toDocumentTypeBackendReadDatabase(db: Database.Database): DocumentTypeBackendReadDatabase {
  return {
    prepare(sql: string): DocumentTypeBackendStatement {
      const statement = db.prepare(sql);
      return {
        get: (...params: readonly unknown[]) => statement.get(...params),
        all: (...params: readonly unknown[]) => statement.all(...params),
        run: (...params: readonly unknown[]) => statement.run(...params),
      };
    },
  };
}

/**
 * 初始化 Workspace 服务
 */
async function initExplorerContext(): Promise<ExplorerContext> {
  const [{ WorkspaceService }, { getWorkspaceDataPath }] = await Promise.all([
    import('src/electron-main/services/workspace/workspace'),
    import('src/shared/utils/pathManager'),
  ]);
  const database = new Database(path.join(getWorkspaceDataPath(), 'workspace.sqlite'), {
    readonly: true,
    fileMustExist: true,
  });

  return {
    database,
    workspaceService: new WorkspaceService(database),
  };
}

/**
 * 打印帮助信息
 */
function showHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
Workspace Explorer - Workspace 浏览与调试工具

用法：
  pnpm run test:workspace-explorer -- <命令> [参数...] [--prod]

默认只读打开开发库；--prod 显式选择生产数据路径。该脚本不会初始化或迁移数据库。

命令：
  list-projects
      列出所有项目（projects 表）。

  list-nodes <projectId> [parentNodeId]
      列出某项目 / 某文件夹下的节点（workspace_nodes 表）。

  recent-docs [limit]
      查看最近打开的文档（基于 WorkspaceService.getRecentDocuments）。

  show-doc-json <documentId>
      显示指定文档的底层 JSON 内容：
      - type=document 时，从 document_versions 读取最新版本 content_json；
      - type=mindmap 时，通过文档类型 hook 读取后端视图结果。
`);
}

/**
 * 列出所有项目
 */
async function handleListProjects(ctx: ExplorerContext): Promise<void> {
  const projects = ctx.workspaceService.getAllProjects();

  if (projects.length === 0) {
    // eslint-disable-next-line no-console
    console.log('当前没有任何项目。');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`共 ${projects.length} 个项目：\n`);
  for (const project of projects) {
    // eslint-disable-next-line no-console
    console.log(`- id: ${project.id}`);
    // eslint-disable-next-line no-console
    console.log(`  name: ${project.name}`);
    // eslint-disable-next-line no-console
    console.log(`  description: ${project.description ?? '无'}`);
    // eslint-disable-next-line no-console
    console.log(`  created_at: ${new Date(project.created_at).toLocaleString()}`);
    // eslint-disable-next-line no-console
    console.log('');
  }
}

/**
 * 列出某项目 / 某文件夹下的节点
 */
async function handleListNodes(
  ctx: ExplorerContext,
  projectId: string | undefined,
  parentNodeId: string | undefined
): Promise<void> {
  if (!projectId || projectId.trim().length === 0) {
    // eslint-disable-next-line no-console
    console.error('❌ list-nodes 需要提供 <projectId> 参数');
    return;
  }

  const trimmedProjectId = projectId.trim();
  const parentId =
    parentNodeId && parentNodeId.trim().length > 0 ? parentNodeId.trim() : null;

  const nodes = ctx.workspaceService.getChildNodes(parentId, trimmedProjectId);

  if (nodes.length === 0) {
    // eslint-disable-next-line no-console
    console.log('没有找到任何子节点。');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`共 ${nodes.length} 个节点：\n`);
  nodes.forEach((node: WorkspaceNode) => {
    // eslint-disable-next-line no-console
    console.log(`- id: ${node.id}`);
    // eslint-disable-next-line no-console
    console.log(`  name: ${node.name}`);
    // eslint-disable-next-line no-console
    console.log(`  type: ${node.type}`);
    // eslint-disable-next-line no-console
    console.log(`  parent_id: ${node.parent_id ?? 'null'}`);
    // eslint-disable-next-line no-console
    console.log(`  updated_at: ${new Date(node.updated_at).toLocaleString()}`);
    // eslint-disable-next-line no-console
    console.log('');
  });
}

/**
 * 查看最近打开的文档
 */
async function handleRecentDocs(ctx: ExplorerContext, limitArg: string | undefined): Promise<void> {
  const limit =
    limitArg && !Number.isNaN(Number(limitArg)) ? Math.max(1, Number(limitArg)) : 8;

  const docs = ctx.workspaceService.getRecentDocuments(limit);

  if (docs.length === 0) {
    // eslint-disable-next-line no-console
    console.log('最近没有打开过任何文档。');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`最近打开的文档（最多 ${limit} 个）：\n`);
  docs.forEach((doc: RecentDocumentInfo) => {
    // eslint-disable-next-line no-console
    console.log(`- id: ${doc.id}`);
    // eslint-disable-next-line no-console
    console.log(`  name: ${doc.name}`);
    // eslint-disable-next-line no-console
    console.log(`  type: ${doc.type}`);
    // eslint-disable-next-line no-console
    console.log(`  project_id: ${doc.project_id ?? 'null'}`);
    if (doc.last_opened_at) {
      // eslint-disable-next-line no-console
      console.log(`  last_opened_at: ${new Date(doc.last_opened_at).toLocaleString()}`);
    }
    // eslint-disable-next-line no-console
    console.log(`  updated_at: ${new Date(doc.updated_at).toLocaleString()}`);
    // eslint-disable-next-line no-console
    console.log('');
  });
}

/**
 * 显示文档 JSON 内容（自动判断 markdown / mindmap）
 */
async function handleShowDocJson(ctx: ExplorerContext, documentId: string | undefined): Promise<void> {
  if (!documentId || documentId.trim().length === 0) {
    // eslint-disable-next-line no-console
    console.error('❌ show-doc-json 需要提供 <documentId> 参数');
    return;
  }

  const trimmedId = documentId.trim();
  const node = ctx.workspaceService.getNode(trimmedId);

  if (!node) {
    // eslint-disable-next-line no-console
    console.error(`❌ 未找到节点：${trimmedId}`);
    return;
  }

  if (node.type === 'mindmap') {
    const [pluginRegistry, backendContract] = await Promise.all([
      import('src/app-hosts/linnya/plugin-registry/builtin'),
      import('@plugin/backend/documentTypeBackendHook'),
    ]);
    pluginRegistry.ensureBuiltinBackendPluginsRegistered();
    const { getDocumentTypeBackendHook } = backendContract;
    const hook = getDocumentTypeBackendHook('mindmap', { includeDisabled: true });
    if (!hook?.readVfsContent) {
      // eslint-disable-next-line no-console
      console.error('❌ MindMap 后端 hook 未注册，无法读取文档内容');
      return;
    }
    const doc = hook.readVfsContent({
      db: toDocumentTypeBackendReadDatabase(ctx.database),
      nodeId: trimmedId,
      nodeName: node.name,
      nodePath: node.name,
    });
    if (!doc) {
      // eslint-disable-next-line no-console
      console.error(`❌ mindmap_versions 中未找到文档：${trimmedId}`);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`\nMindMap 文档 hook 读取结果（node_id=${trimmedId}）：\n`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  // 其余类型统一按 markdown 文档处理
  try {
    const { MarkdownDocumentService } = await import('src/domains/markdown');
    const content = new MarkdownDocumentService(ctx.database).getDocument(trimmedId);
    // eslint-disable-next-line no-console
    console.log(`\nMarkdown 文档 JSON（node_id=${trimmedId}）：\n`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(content, null, 2));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`❌ 读取 Markdown 文档失败：${(error as Error).message}`);
  }
}

/**
 * 主入口：解析命令并调度
 */
async function main(): Promise<void> {
  const args = processArgs.filter(argument => argument !== '--prod');
  const command = args[0] ?? 'help';

  if (command === 'help') {
    showHelp();
    return;
  }

  const ctx = await initExplorerContext();

  try {
    if (command === 'list-projects') {
      await handleListProjects(ctx);
    } else if (command === 'list-nodes') {
      await handleListNodes(ctx, args[1], args[2]);
    } else if (command === 'recent-docs') {
      await handleRecentDocs(ctx, args[1]);
    } else if (command === 'show-doc-json') {
      await handleShowDocJson(ctx, args[1]);
    } else {
      // eslint-disable-next-line no-console
      console.error(`未知命令: ${command}`);
      showHelp();
    }
  } finally {
    ctx.database.close();
  }
}

// 执行主函数
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
