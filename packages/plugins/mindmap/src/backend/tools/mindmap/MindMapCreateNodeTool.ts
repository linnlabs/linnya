/**
 * @file MindMapCreateNodeTool.ts
 * @description MindMap 新建节点工具 - 在指定父节点下追加子节点
 *
 * 中文说明：
 * - 用于 agent 在推理过程中“新增节点（提出假设/问题/结论等）”
 * - 只做数据层写入：修改 mindmap_versions.content_json（生成新版本）
 * - 并发策略：通过 per-document 写入队列（mindmapWriteQueue）串行化"读-改-写"，避免并行写版本产生 CAS 冲突
 * - CAS 乐观锁仍然保留作为最后防线（防止绕过队列的写入路径）
 *
 * 语义对齐（与前端 addChild 行为一致）：
 * - 如果父节点处于折叠状态（expanded === false），会先将其设为展开（expanded = true）
 * - 新节点默认只写入 { id, topic }，不主动补齐 children/style 等可选字段
 */
import { v4 as uuidv4 } from 'uuid';
import { BaseTool, type ToolContext, type ToolParameterSchema } from '@plugin/backend/toolRuntime';
import type { StructuredToolResult } from '@plugin/backend/toolRuntime';
import { generateRefMapWithCollisionCheck } from '@plugin/backend/blockReferenceRuntime';
import {
  buildChangedNodeRefs,
  collectAllNodeIds,
  findNode,
  initMindMapDocContext,
  saveMindMapVersion,
  type MindMapDocContext,
  type MindMapNodeObj,
} from './mindmapToolUtils';
import {
  parseNodeKind,
  normalizeTaggingForKind,
  type NodeKind,
} from './taggingRules';
import { withMindMapWriteLock } from './mindmapWriteQueue';

// ============================================================================
// 类型定义
// ============================================================================

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s.length > 0 ? s : undefined;
}

/**
 * 单个新增节点操作
 */
interface CreateNodeOperation {
  /**
   * 父节点 ref（优先）
   */
  parentNodeRef?: string;
  /**
   * 父节点 ID（不推荐，但允许）
   */
  parentNodeId?: string;
  /**
   * 新节点标题（topic）
   */
  topic: string;
  /**
   * 节点语义类型（可选）
   *
   * 中文说明：
   * - 推荐在创建节点时就指定类型，避免后续需要额外调用 mindmap_tag_node 设置 kind
   * - 有效值：hypothesis（假设）/ question（子问题）/ conclusion（结论）
   * - 只有设置了 kind 后，才能对节点设置 status/confidence
   */
  kind?: string;
}

interface CreateNodeResultItem {
  parentNodeId: string;
  parentNodeRef?: string;
  nodeId: string;
  nodeRef?: string;
  topic: string;
  /** 节点类型（如果创建时指定了 kind） */
  kind?: string;
}

interface CreateNodeResultData {
  documentId: string;
  /** 文档名称（workspace_nodes.name），用于 UI 标题/列表展示 */
  documentName: string;
  baseVersionNumber: number;
  versionNumber: number;
  createdCount: number;
  changedNodeIds: string[];
  changedNodeRefs: string[];
  results: CreateNodeResultItem[];
  warnings?: string[];
}

// ============================================================================
// 工具实现
// ============================================================================

export class MindMapCreateNodeTool extends BaseTool {
  readonly name = 'mindmap_create_node';

  get description() {
    return [
      '在指定父节点下新建子节点（追加到 children 末尾）。',
      '',
      '使用场景：',
      '- agent 在 Issue Tree 中提出新的假设/问题/结论节点',
      '',
      '参数说明：',
      '- document_id：MindMap 文档 ID',
      '- parent_node_ref：父节点短 ref（如 #k9Q2x7 或 k9Q2x7；推荐）',
      '- topic：新节点标题',
      '- kind：节点语义类型（推荐：hypothesis/question/conclusion）',
      '  创建节点时指定 kind，后续才能用 mindmap_tag_node 设置 status/confidence',
      '',
      '批量新增：使用 operations 数组一次创建多个节点。',
      '',
      '注意：工具通过 per-document 写入队列串行化"读-改-写"，支持并行子 agent 安全写图；CAS 乐观锁仍保留作为最后防线。',
    ].join('\n');
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'MindMap 文档 ID' },
      // 单节点快捷参数
      parent_node_ref: { type: 'string', description: '父节点短 ref（如 #k9Q2x7 或 k9Q2x7）' },
      parent_node_id: { type: 'string', description: '父节点 ID（不推荐，优先使用 parent_node_ref）' },
      topic: { type: 'string', description: '新节点标题（topic）' },
      kind: {
        type: 'string',
        description: '节点语义类型（推荐：hypothesis/question/conclusion）。创建时指定 kind，后续才能设置 status/confidence',
      },
      // 批量参数
      operations: {
        type: 'array',
        description: '批量新增节点操作（与单节点参数互斥）',
        items: {
          type: 'object',
          description: '单个新增节点操作',
          properties: {
            parent_node_ref: { type: 'string', description: '父节点短 ref（可带或不带 #）' },
            parent_node_id: { type: 'string', description: '父节点 ID（不推荐）' },
            topic: { type: 'string', description: '新节点标题（topic）' },
            kind: {
              type: 'string',
              description: '节点语义类型（推荐：hypothesis/question/conclusion）',
            },
          },
        },
      },
    },
    required: ['document_id'],
  };

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    // 1) 参数校验（锁外：纯逻辑，不读写数据库）
    const documentId = args.document_id;

    if (typeof documentId !== 'string' || documentId.trim().length === 0) {
      throw new Error('document_id 必须是非空字符串');
    }

    // 2) 解析操作列表（锁外：纯参数解析）
    const operations = this.parseOperations(args);
    if (operations.length === 0) {
      throw new Error('未提供有效的新建节点操作（需要 topic，且可选 parent_node_ref / parent_node_id）');
    }

    // 3-6) 锁内执行：重读最新版本 → apply → save → 重建 refMap
    // 中文说明（根因级）：
    // - 并行子 agent 可能同时写同一 MindMap 文档；
    // - 若不串行化"读-改-写"，CAS 会导致其中一方"版本冲突 → throw"；
    // - 通过 withMindMapWriteLock 保证同一 documentId 的写入 FIFO 串行执行；
    // - 在锁内重新 initMindMapDocContext 确保 baseVersion 是最新的。
    const abortSignal = context.abortSignal as AbortSignal | undefined;

    const { result: writeResult } = await withMindMapWriteLock({
      documentId,
      purpose: 'create_node',
      abortSignal,
      fn: async () => {
        // 3) 锁内初始化文档上下文（读取最新版本）
        const initResult = initMindMapDocContext(documentId, context);
        if (!initResult.success) {
          throw new Error(initResult.error);
        }
        const ctx = initResult.ctx;
        const baseVersionNumberUsed = ctx.versionNumber;

        // 4) 执行新增
        const warnings: string[] = [];
        const changedNodeIds: string[] = [];
        const results: CreateNodeResultItem[] = [];

        for (const op of operations) {
          const item = this.applyCreateNodeOperation(op, ctx);
          results.push(item);
          for (const id of [item.parentNodeId, item.nodeId]) {
            if (!changedNodeIds.includes(id)) changedNodeIds.push(id);
          }
        }

        // 5) 保存新版本
        let newVersionNumber = baseVersionNumberUsed;
        if (results.length > 0) {
          const saveResult = saveMindMapVersion(ctx);
          newVersionNumber = saveResult.versionNumber;
        }

        // 6) 新增节点后需要重建 refMap（否则无法返回新节点 ref）
        const allNodeIdsAfter = collectAllNodeIds(ctx.nodeData);
        const refMapAfter = generateRefMapWithCollisionCheck(allNodeIdsAfter);
        const changedNodeRefs = buildChangedNodeRefs(changedNodeIds, refMapAfter);

        // 回填每个结果的 ref
        for (const r of results) {
          r.parentNodeRef = refMapAfter.get(r.parentNodeId);
          r.nodeRef = refMapAfter.get(r.nodeId);
        }

        return {
          documentName: ctx.documentName,
          baseVersionNumberUsed,
          newVersionNumber,
          changedNodeIds,
          changedNodeRefs,
          results,
          warnings,
        };
      },
    });

    const data: CreateNodeResultData = {
      documentId,
      documentName: writeResult.documentName,
      baseVersionNumber: writeResult.baseVersionNumberUsed,
      versionNumber: writeResult.newVersionNumber,
      createdCount: writeResult.results.length,
      changedNodeIds: writeResult.changedNodeIds,
      changedNodeRefs: writeResult.changedNodeRefs,
      results: writeResult.results,
      warnings: writeResult.warnings.length > 0 ? writeResult.warnings : undefined,
    };

    const observation = this.buildObservation(data);
    const result: StructuredToolResult<CreateNodeResultData> = { data, observation };
    return JSON.stringify(result, null, 2);
  }

  private parseOperations(args: Record<string, unknown>): CreateNodeOperation[] {
    const ops = args.operations;
    if (Array.isArray(ops)) {
      return ops
        .map((op) => (isRecord(op) ? op : null))
        .filter((op): op is UnknownRecord => !!op)
        .map((op): CreateNodeOperation | null => {
          const topic = readNonEmptyString(op.topic);
          if (!topic) return null;
          const parentNodeRef = readNonEmptyString(op.parent_node_ref);
          const parentNodeId = readNonEmptyString(op.parent_node_id);
          const kind = readNonEmptyString(op.kind);
          return { topic, parentNodeRef, parentNodeId, kind };
        })
        .filter((op): op is CreateNodeOperation => !!op);
    }

    // 单节点快捷参数
    const topic = readNonEmptyString(args.topic);
    if (!topic) return [];
    const parentNodeRef = readNonEmptyString(args.parent_node_ref);
    const parentNodeId = readNonEmptyString(args.parent_node_id);
    const kind = readNonEmptyString(args.kind);
    return [{ topic, parentNodeRef, parentNodeId, kind }];
  }

  private applyCreateNodeOperation(op: CreateNodeOperation, ctx: MindMapDocContext): CreateNodeResultItem {
    const parent = this.resolveParentNode(op, ctx);

    // 与前端语义对齐：父节点如果是折叠（expanded === false），先展开
    if (parent.expanded === false) {
      parent.expanded = true;
    }

    const newNodeId = uuidv4();
    const newNode: MindMapNodeObj = {
      id: newNodeId,
      topic: op.topic,
      children: [],
    };

    // 如果指定了 kind，校验并写入 tagging.labels.kind
    if (op.kind) {
      const parsedKind = parseNodeKind(op.kind);
      if (!parsedKind) {
        throw new Error(
          `kind "${op.kind}" 不是有效的节点类型。有效值：hypothesis / question / conclusion`
        );
      }
      // 使用 normalizeTaggingForKind 生成符合规则的 tagging（自动包含 labels.kind）
      newNode.tagging = normalizeTaggingForKind(parsedKind, undefined);
    }

    const childrenValue = parent.children;
    if (childrenValue === undefined) {
      parent.children = [newNode];
    } else if (Array.isArray(childrenValue)) {
      childrenValue.push(newNode);
    } else {
      // 数据不合法：children 不是数组
      throw new Error(`父节点 children 字段不是数组，无法追加子节点（parentId=${parent.id}）`);
    }

    return {
      parentNodeId: parent.id,
      nodeId: newNodeId,
      topic: op.topic,
      kind: op.kind ? parseNodeKind(op.kind) : undefined,
    };
  }

  private resolveParentNode(op: CreateNodeOperation, ctx: MindMapDocContext): MindMapNodeObj {
    // 允许不传 parent：默认以 root 为父节点（对齐“新增一级节点”的常见需求）
    const hasParentRef = !!op.parentNodeRef;
    const hasParentId = !!op.parentNodeId;
    if (!hasParentRef && !hasParentId) {
      return ctx.nodeData;
    }

    const findResult = findNode(ctx.nodeData, ctx.allNodeIds, op.parentNodeRef, op.parentNodeId);
    if (!findResult.success || !findResult.node || !findResult.nodeId) {
      throw new Error(findResult.error || '父节点未找到');
    }
    return findResult.node;
  }

  private buildObservation(data: CreateNodeResultData): string {
    const parts: string[] = [];
    if (data.versionNumber > data.baseVersionNumber) {
      parts.push(`已写入新版本 v${data.versionNumber}`);
    }
    if (data.createdCount > 0) {
      // 输出每个新增节点的 ref 和 kind（如果有）
      const descriptions = data.results.map((r) => {
        const ref = r.nodeRef ?? r.nodeId;
        const kindSuffix = r.kind ? ` (kind=${r.kind})` : '';
        return `${ref}${kindSuffix}`;
      });
      parts.push(`新增节点：${descriptions.join('、')}`);
    }
    if (data.warnings && data.warnings.length > 0) {
      parts.push(`警告：${data.warnings.join('；')}`);
    }
    return parts.join('\n') || '无变更';
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = JSON.parse(output) as { data?: CreateNodeResultData };
      const n = parsed.data?.createdCount ?? 0;
      if (n > 0) return `已新建 ${n} 个 MindMap 节点。`;
      return '执行了 MindMap 新建节点工具。';
    } catch {
      return '执行 mindmap_create_node 工具。';
    }
  }
}
