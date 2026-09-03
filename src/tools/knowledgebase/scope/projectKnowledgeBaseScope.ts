/**
 * @file projectKnowledgeBaseScope.ts
 * @description
 * 为工具调用解析“知识库作用域”。
 *
 * 背景：知识库已支持“多个 + 可关联项目”。
 * - 当对话绑定到某个 Workspace 项目时，知识库相关工具（搜索 / 列表 / 阅读）必须限定到该项目关联的知识库。
 * - 当项目未关联任何知识库时，为保证基础可用性，默认回退到 default 知识库。
 */

import type { ToolContext } from '../../types';

export type KnowledgeBaseScope =
  | {
      kind: 'project';
      projectId: string;
      kbIds: string[];
    };

function normalizeId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqNonEmpty(ids: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const normalized = id.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/**
 * 解析本次工具调用应当作用的知识库列表。
 *
 * 规则：
 * - 有 workspaceProjectId：优先使用项目关联知识库；如无关联，则回退到 default。
 * - 无 workspaceProjectId：直接报错（不再兼容旧链路的“无项目知识库访问”）。
 */
export function resolveKnowledgeBaseScopeFromContext(
  context: ToolContext
): KnowledgeBaseScope {
  const projectId = normalizeId(context.workspaceProjectId);

  // 1) 项目作用域：从 project_knowledge_base_links 查询
  if (projectId) {
    const databaseService = context.databaseService;
    if (!databaseService) {
      throw new Error(
        '工具上下文缺少 databaseService，无法按项目解析关联的知识库。'
      );
    }

    const db = databaseService.getDb();
    const rows = db
      .prepare(
        'SELECT kb_id FROM project_knowledge_base_links WHERE project_id = ? ORDER BY created_at ASC'
      )
      .all(projectId) as Array<{ kb_id: string }>;

    const kbIds = uniqNonEmpty(rows.map((r) => r.kb_id));

    // 项目未关联知识库：回退到 default（与系统默认知识库保持一致）
    if (kbIds.length === 0) {
      return {
        kind: 'project',
        projectId,
        kbIds: ['default']
      };
    }

    return {
      kind: 'project',
      projectId,
      kbIds
    };
  }

  throw new Error(
    '当前对话未绑定 Workspace 项目（缺少 workspaceProjectId），知识库工具不允许在无项目上下文中执行。'
  );
}

/**
 * 校验某个 kbId 是否允许在当前 scope 下被访问。
 * - scope.kind === 'project' 时：必须属于项目关联 kbIds
 */
export function assertKbAllowedInScope(scope: KnowledgeBaseScope, kbId: string): void {
  const normalizedKbId = kbId.trim();
  if (!normalizedKbId) {
    throw new Error('kbId 不能为空');
  }

  if (scope.kind === 'project') {
    if (!scope.kbIds.includes(normalizedKbId)) {
      throw new Error(
        `当前对话绑定的项目(${scope.projectId})未关联知识库(${normalizedKbId})，禁止跨项目知识库访问。`
      );
    }
  }
}

/**
 * 校验某个文档所属知识库是否允许在当前 scope 下被访问。
 */
export function assertDocumentKbAllowedInScope(
  scope: KnowledgeBaseScope,
  docKbId: string,
  docIdForMessage?: string
): void {
  const normalizedDocKbId = docKbId.trim();
  if (!normalizedDocKbId) {
    throw new Error('文档缺少 kbId，无法校验访问范围');
  }

  if (scope.kind !== 'project') return;

  if (!scope.kbIds.includes(normalizedDocKbId)) {
    const docInfo = docIdForMessage ? `doc_id=${docIdForMessage}` : 'doc_id=unknown';
    throw new Error(
      `当前对话绑定的项目(${scope.projectId})未关联该文档所在知识库(${normalizedDocKbId})，禁止跨项目阅读（${docInfo}）。`
    );
  }
}
