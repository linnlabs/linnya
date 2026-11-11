import { existsSync } from 'node:fs';
import { ProbeError } from '../definitions/probeContract.mjs';
import { evaluate } from '../infrastructure/cdpClient.mjs';
import { instanceWorkspaceDb } from '../infrastructure/instanceStore.mjs';
import { pageFacts, settlePage } from './probePage.mjs';

/** 只读查询本实例 Workspace，识别 ID 属于对话、文档还是项目，并取得导航所需的项目与类型。 */
async function resolveWorkspaceObject(session, id) {
  if (id === 'assistant') return { kind: 'assistant' };
  const path = instanceWorkspaceDb(session.root);
  if (!existsSync(path)) throw new ProbeError('NOT_FOUND', '该实例还没有 Workspace 数据库');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const conversation = db.prepare('SELECT title, project_id AS projectId FROM conversations WHERE conversation_id = ?').get(id);
    if (conversation) return { kind: 'conversation', ...conversation };
    const node = db.prepare('SELECT type AS nodeType, name AS title, project_id AS projectId, deleted_at AS deletedAt FROM workspace_nodes WHERE id = ?').get(id);
    if (node?.deletedAt) throw new ProbeError('NOT_FOUND', `文档 ${id} 已删除`);
    if (node) return { kind: 'document', nodeType: node.nodeType, title: node.title, projectId: node.projectId };
    const project = db.prepare('SELECT name AS title FROM projects WHERE id = ? AND deleted_at IS NULL').get(id);
    if (project) return { kind: 'project', projectId: id, title: project.title };
  } finally {
    db.close();
  }
  throw new ProbeError('NOT_FOUND', `找不到对话、文档或项目 ${id}`, '确认 ID 属于本实例的数据；要用现有数据先 stop，再 up --clone-data _dev_data');
}

function navigationCall(target, id, overview) {
  const scope = target.projectId ? { kind: 'project', projectId: target.projectId } : { kind: 'linnya-assistant' };
  if (overview) {
    if (!target.projectId) throw new ProbeError('USAGE', '--overview 需要项目或项目内对象');
    return ['openProjectOverview', target.projectId];
  }
  if (target.kind === 'conversation') return ['openConversation', { conversationId: id, scope }];
  if (target.kind === 'document') {
    return ['openDocumentByNodeType', { documentId: id, projectId: target.projectId, nodeType: target.nodeType, displayName: target.title }];
  }
  return ['openWorkspace', scope];
}

export async function openWorkspaceObject(cdp, session, id, { overview = false } = {}) {
  const target = await resolveWorkspaceObject(session, id);
  const [method, request] = navigationCall(target, id, overview);
  // 从 Vite 取 Renderer 正在用的同一个导航端口：保存旧文档、切换范围与插件检查都与用户点击一致，产品代码无需为探针留入口。
  const call = () => evaluate(cdp, `(async () => {
    let port;
    try {
      port = (await import('/apps/renderer/shared/ports/workspaceNavigationPort.ts')).getWorkspaceNavigationPort();
    } catch {
      return { missing: true };
    }
    await port[${JSON.stringify(method)}](${JSON.stringify(request)});
    return { missing: false };
  })()`, 15_000);
  // 就绪已等插件加载结束；个别插件注册文件处理器稍晚时仍会短暂失败，只对这一种失败重试，其余错误原样报出。
  const deadline = Date.now() + 10_000;
  let outcome;
  for (;;) {
    try {
      outcome = await call();
      break;
    } catch (error) {
      if (!/未注册类型|unsupported document node type/.test(error.message) || Date.now() > deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  if (outcome.missing) throw new ProbeError('UNSUPPORTED', '当前 Renderer 不是 Vite 开发模式，无法取得导航端口', 'open 只支持 --mode dev');
  const settled = await settlePage(cdp);
  const after = await pageFacts(cdp);
  // 面包屑是用户看到的“现在在哪”，用它回报落点，不必再截图确认。
  const location = await evaluate(cdp, `[...document.querySelectorAll('.breadcrumb-segment')]
    .map(element => element.innerText.trim()).filter(Boolean).join(' / ') || null`);
  return {
    opened: { kind: overview ? 'overview' : target.kind, id, title: target.title ?? null, projectId: target.projectId ?? null, ...(target.nodeType && { nodeType: target.nodeType }) },
    settled, after: { location, focus: after.focus, layers: after.layers },
  };
}
