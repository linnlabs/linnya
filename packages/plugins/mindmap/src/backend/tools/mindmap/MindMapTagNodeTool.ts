/**
 * @file MindMapTagNodeTool.ts
 * @description MindMap 节点打标工具 - 设置 status/confidence/labels
 *
 * 中文说明：
 * - 用于 Issue Tree / 假设验证场景
 * - 支持批量打标多个节点（一次调用可修改多个节点）
 * - 不涉及证据操作（证据由 attach_evidence 工具处理）
 *
 * @see packages/plugins/mindmap/src/renderer/docs/README.md
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '@plugin/backend/toolRuntime';
import type { StructuredToolResult } from '@plugin/backend/toolRuntime';
import {
  initMindMapDocContext,
  findNode,
  saveMindMapVersion,
  buildChangedNodeRefs,
  type MindMapNodeObj
} from './mindmapToolUtils';
import { withMindMapWriteLock } from './mindmapWriteQueue';
import {
  canSetConfidenceForKind,
  canSetStatusForKind,
  hasDisallowedLabelKeys,
  isValidConfidenceValue,
  isValidStatusValue,
  normalizeTaggingForKind,
  parseNodeKind,
  RECOMMENDED_CONFIDENCE,
  RECOMMENDED_STATUS,
  type NodeKind,
} from './taggingRules';

// ============================================================================
// 类型定义
// ============================================================================

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 单个节点的打标操作
 */
interface NodeTagOperation {
  nodeRef?: string;
  nodeId?: string;
  status?: string;
  confidence?: string | number;
  labels?: Record<string, string | number | boolean>;
  labelsMode?: 'merge' | 'replace';
}

/**
 * 工具返回数据
 */
interface TagNodeResultData {
  documentId: string;
  /** 文档名称（workspace_nodes.name），用于 UI 标题展示 */
  documentName: string;
  changedNodeIds: string[];
  changedNodeRefs: string[];
  /**
   * 节点变更明细（按节点聚合）
   *
   * 中文说明：
   * - UI 需要"第一行节点引用、第二行变更详情"的结构；
   * - 同一节点可能在批量 operations 中被多次更新，这里按 nodeId 合并展示。
   */
  results: Array<{
    nodeId: string;
    nodeRef?: string;
    /** 节点内容（topic），用于 UI 一行省略展示 */
    topic: string;
    updates: {
      status?: string;
      confidence?: string | number;
      /** 仅允许 kind（见 taggingRules） */
      kind?: string;
    };
  }>;
  warnings?: string[];
}

// ============================================================================
// 工具实现
// ============================================================================

export class MindMapTagNodeTool extends BaseTool {
  readonly name = 'mindmap_tag_node';

  get description() {
    return [
      '对 MindMap 节点进行打标（设置状态/置信度/标签）。读取节点短 ref 时使用 read_file 的 view="document" 模式。',
      '',
      '使用场景：',
      '- Issue Tree 假设验证：将节点标记为 verified/refuted',
      '- 置信度评估：标记 high/medium/low',
      '',
      '参数说明：',
      '- node_ref：目标节点的短 ref（如 #k9Q2x7 或 k9Q2x7），从 read_file(view="document") 获取',
      '- status：节点状态（推荐值：open/verified/refuted/closed）',
      '- confidence：置信度（推荐值：high/medium/low，也可以是数值）',
      '- labels：扩展标签（可选）',
      '',
      '批量打标：使用 operations 数组一次修改多个节点',
      '',
      '注意：工具通过 per-document 写入队列串行化"读-改-写"，支持并行子 agent 安全写图；CAS 乐观锁仍保留作为最后防线。'
    ].join('\n');
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'MindMap 文档 ID'
      },
      // 单节点快捷参数
      node_ref: {
        type: 'string',
        description: '目标节点短 ref（如 #k9Q2x7 或 k9Q2x7），单节点打标时使用'
      },
      status: {
        type: 'string',
        description: '节点状态：open/verified/refuted/closed'
      },
      confidence: {
        // 当前产品合同只向模型公开稳定枚举；历史 number 输入仍由工具 owner 读取。
        type: 'string',
        description: '置信度：high/medium/low'
      },
      labels: {
        type: 'object',
        description: '扩展标签'
      },
      // 批量操作参数
      operations: {
        type: 'array',
        description: '批量打标操作（与单节点参数互斥）',
        items: {
          type: 'object',
          description: '单个节点的打标操作（批量）',
          properties: {
            node_ref: { type: 'string', description: '节点短 ref（可带或不带 #）' },
            node_id: { type: 'string', description: '节点 ID（不推荐）' },
            status: { type: 'string', description: '节点状态（推荐：open/verified/refuted/closed）' },
            confidence: {
              type: 'string',
              description: '置信度（推荐：high/medium/low；也可传数值，运行时兼容）'
            },
            labels: { type: 'object', description: '扩展标签（可选）' },
            labels_mode: {
              type: 'string',
              enum: ['merge', 'replace'],
              description: 'labels 写入模式：merge 合并（默认） / replace 覆盖'
            }
          }
        }
      }
    },
    required: ['document_id']
  };

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    // 1. 参数校验（锁外：纯逻辑，不读写数据库）
    const documentId = args.document_id;

    if (typeof documentId !== 'string' || documentId.trim().length === 0) {
      // 规范：工具执行失败必须 throw，由执行层统一标记 tool_output.status=error
      throw new Error('document_id 必须是非空字符串');
    }

    // 2. 解析操作列表（锁外：纯参数解析）
    const operations = this.parseOperations(args);
    if (operations.length === 0) {
      throw new Error('未提供有效的打标操作（需要 node_ref + status/confidence/labels）');
    }

    // 3-6. 锁内执行：重读最新版本 → apply → save
    // 中文说明（根因级）：
    // - 并行子 agent 可能同时打标同一 MindMap 文档的不同节点；
    // - 若不串行化"读-改-写"，CAS 会导致其中一方"版本冲突 → throw"；
    // - 通过 withMindMapWriteLock 保证同一 documentId 的写入 FIFO 串行执行。
    const abortSignal = context.abortSignal as AbortSignal | undefined;

    const { result: writeResult } = await withMindMapWriteLock({
      documentId,
      purpose: 'tag_node',
      abortSignal,
      fn: async () => {
        // 3. 锁内初始化文档上下文（读取最新版本）
        const initResult = initMindMapDocContext(documentId, context);
        if (!initResult.success) {
          throw new Error(initResult.error);
        }
        const ctx = initResult.ctx;

        // 4. 执行打标
        const warnings: string[] = [];
        const changedNodeIds: string[] = [];
        const resultByNodeId = new Map<
          string,
          {
            nodeId: string;
            nodeRef?: string;
            topic: string;
            updates: { status?: string; confidence?: string | number; kind?: string };
          }
        >();

        for (const op of operations) {
          const result = this.applyTagOperation(op, ctx);
          if (result.success && result.nodeId) {
            const didChange = !!(result.statusChanged || result.confidenceChanged || result.labelsChanged);
            if (!didChange) {
              // 中文说明：操作合法但没有产生实际变更（例如重复写入相同值）——不计入 changed 列表，也不触发保存。
              continue;
            }
            if (!changedNodeIds.includes(result.nodeId)) {
              changedNodeIds.push(result.nodeId);
            }

            const nodeRef = ctx.refMap.get(result.nodeId);
            const existing = resultByNodeId.get(result.nodeId) ?? {
              nodeId: result.nodeId,
              nodeRef,
              topic: result.nodeTopic ?? '',
              updates: {},
            };

            // 中文说明：只记录"确实发生变化"的字段，避免 UI 展示误导性信息
            if (result.statusChanged && result.updatedStatus !== undefined) {
              existing.updates.status = result.updatedStatus;
            }
            if (result.confidenceChanged && result.updatedConfidence !== undefined) {
              existing.updates.confidence = result.updatedConfidence;
            }
            if (result.labelsChanged && result.updatedKind !== undefined) {
              existing.updates.kind = result.updatedKind;
            }

            existing.nodeRef = nodeRef ?? existing.nodeRef;
            // 中文说明：topic 以"首次命中"为准；如果缺失则用最新值补齐
            if (!existing.topic && result.nodeTopic) {
              existing.topic = result.nodeTopic;
            }
            resultByNodeId.set(result.nodeId, existing);
          }
        }

        // 5. 保存新版本
        if (changedNodeIds.length > 0) {
          // 中文说明：
          // - 仍然走 CAS 保存新版本（并发安全），但不把版本号暴露给 AI / UI；
          // - 产品约束：版本号属于内部实现细节，AI 不应感知。
          saveMindMapVersion(ctx);
        }

        // 构建返回数据
        const changedNodeRefs = buildChangedNodeRefs(changedNodeIds, ctx.refMap);

        return {
          documentName: ctx.documentName,
          changedNodeIds,
          changedNodeRefs,
          results: Array.from(resultByNodeId.values()),
          warnings,
        };
      },
    });

    // 6. 构建最终返回
    const data: TagNodeResultData = {
      documentId,
      documentName: writeResult.documentName,
      changedNodeIds: writeResult.changedNodeIds,
      changedNodeRefs: writeResult.changedNodeRefs,
      results: writeResult.results,
      warnings: writeResult.warnings.length > 0 ? writeResult.warnings : undefined
    };

    const observation = this.buildObservation(data);

    const result: StructuredToolResult<TagNodeResultData> = { data, observation };
    return JSON.stringify(result, null, 2);
  }

  /**
   * 解析操作列表（支持单节点快捷参数和批量 operations）
   */
  private parseOperations(args: Record<string, unknown>): NodeTagOperation[] {
    // 优先使用 operations 数组
    if (Array.isArray(args.operations) && args.operations.length > 0) {
      return args.operations
        .filter(isRecord)
        .map((op) => ({
          nodeRef: typeof op.node_ref === 'string' ? op.node_ref : undefined,
          nodeId: typeof op.node_id === 'string' ? op.node_id : undefined,
          status: typeof op.status === 'string' ? op.status : undefined,
          confidence:
            typeof op.confidence === 'string' || typeof op.confidence === 'number' ? op.confidence : undefined,
          labels: isRecord(op.labels) ? (op.labels as Record<string, string | number | boolean>) : undefined,
          labelsMode: op.labels_mode === 'merge' || op.labels_mode === 'replace' ? op.labels_mode : undefined
        }));
    }

    // 单节点快捷参数
    const nodeRef = typeof args.node_ref === 'string' ? args.node_ref : undefined;
    if (nodeRef && nodeRef.trim().length > 0) {
      return [{
        nodeRef,
        status: typeof args.status === 'string' ? args.status : undefined,
        confidence:
          typeof args.confidence === 'string' || typeof args.confidence === 'number' ? args.confidence : undefined,
        labels: isRecord(args.labels) ? (args.labels as Record<string, string | number | boolean>) : undefined
      }];
    }

    return [];
  }

  /**
   * 应用单个打标操作
   */
  private applyTagOperation(
    op: NodeTagOperation,
    ctx: { nodeData: MindMapNodeObj; allNodeIds: string[]; refMap: Map<string, string> }
  ): {
    success: boolean;
    nodeId?: string;
    nodeTopic?: string;
    statusChanged?: boolean;
    confidenceChanged?: boolean;
    labelsChanged?: boolean;
    updatedStatus?: string;
    updatedConfidence?: string | number;
    updatedKind?: string;
  } {
    // 查找节点
    const findResult = findNode(ctx.nodeData, ctx.allNodeIds, op.nodeRef, op.nodeId);
    if (!findResult.success || !findResult.node || !findResult.nodeId) {
      throw new Error(findResult.error || '节点未找到');
    }

    const node = findResult.node;
    const nodeId = findResult.nodeId;
    // 中文说明：topic 用于 UI 展示，统一 trim，避免前端把纯空白当作"缺失"
    const nodeTopic = typeof node.topic === 'string' ? node.topic.trim() : '';

    const existingKind = parseNodeKind(node.tagging?.labels?.kind);
    const existingLabels = isRecord(node.tagging?.labels)
      ? (node.tagging?.labels as Record<string, string | number | boolean>)
      : undefined;

    const mergedLabels = (() => {
      if (op.labels === undefined) return existingLabels;
      if (op.labelsMode === 'replace') return op.labels;
      return { ...(existingLabels ?? {}), ...op.labels };
    })();

    const nextKind = parseNodeKind(mergedLabels?.kind);
    if (mergedLabels?.kind !== undefined && !nextKind) {
      throw new Error(`节点 ${nodeId}：kind="${String(mergedLabels.kind)}" 不是允许的节点类型`);
    }

    if (op.labels !== undefined && hasDisallowedLabelKeys(mergedLabels)) {
      throw new Error(`节点 ${nodeId}：labels 仅允许包含 kind`);
    }

    if (op.status !== undefined) {
      if (!isValidStatusValue(op.status)) {
        throw new Error(`节点 ${nodeId}：status="${String(op.status)}" 不是推荐值（${RECOMMENDED_STATUS.join('/')}）`);
      }
      if (!canSetStatusForKind(nextKind ?? existingKind)) {
        throw new Error(`节点 ${nodeId}：当前节点类型不允许设置 status`);
      }
    }

    if (op.confidence !== undefined) {
      if (!isValidConfidenceValue(op.confidence)) {
        throw new Error(`节点 ${nodeId}：confidence="${String(op.confidence)}" 不是推荐值（${RECOMMENDED_CONFIDENCE.join('/')}）`);
      }
      if (!canSetConfidenceForKind(nextKind ?? existingKind)) {
        throw new Error(`节点 ${nodeId}：当前节点类型不允许设置 confidence`);
      }
    }

    const resolvedKind: NodeKind | undefined = nextKind ?? existingKind;

    // 确保 tagging 存在
    if (!node.tagging) {
      node.tagging = {};
    }

    let statusChanged = false;
    let confidenceChanged = false;
    let labelsChanged = false;
    let updatedStatus: string | undefined;
    let updatedConfidence: string | number | undefined;
    let updatedKind: string | undefined;

    // 设置 status
    if (op.status !== undefined) {
      const status = op.status.toLowerCase();
      const prev = node.tagging.status;
      if (prev !== status) {
        node.tagging.status = status;
        statusChanged = true;
        updatedStatus = status;
      }
    }

    // 设置 confidence
    if (op.confidence !== undefined) {
      const conf = typeof op.confidence === 'string' ? op.confidence.toLowerCase() : op.confidence;
      const prev = node.tagging.confidence;
      if (prev !== conf) {
        node.tagging.confidence = conf;
        confidenceChanged = true;
        updatedConfidence = conf;
      }
    }

    // 设置 labels
    if (op.labels !== undefined) {
      const prevKind = parseNodeKind(node.tagging.labels?.kind);

      const nextLabels =
        op.labelsMode === 'replace'
          ? op.labels
          : {
              ...(isRecord(node.tagging.labels) ? (node.tagging.labels as Record<string, string | number | boolean>) : {}),
              ...op.labels,
            };
      node.tagging.labels = nextLabels;

      const nextKindFinal = parseNodeKind(node.tagging.labels?.kind);
      // 约束：labels 仅允许 kind，因此这里用 kind 作为变化判断
      if (prevKind !== nextKindFinal) {
        labelsChanged = true;
        updatedKind = nextKindFinal ?? undefined;
      }
    }

    node.tagging = normalizeTaggingForKind(resolvedKind, node.tagging);

    // normalize 之后，补齐最终值（避免 UI 看到"变化"但值为空）
    const finalTagging = node.tagging;
    if (statusChanged && updatedStatus === undefined && typeof finalTagging?.status === 'string') {
      updatedStatus = finalTagging.status;
    }
    if (confidenceChanged && updatedConfidence === undefined && finalTagging?.confidence !== undefined) {
      updatedConfidence = finalTagging.confidence as string | number;
    }
    if (labelsChanged && updatedKind === undefined) {
      const k = parseNodeKind(finalTagging?.labels?.kind);
      updatedKind = k ?? undefined;
    }

    return {
      success: true,
      nodeId,
      nodeTopic,
      statusChanged,
      confidenceChanged,
      labelsChanged,
      updatedStatus,
      updatedConfidence,
      updatedKind,
    };
  }

  private buildObservation(data: TagNodeResultData): string {
    const parts: string[] = [];

    // 中文说明：产品约束 - 版本号属于内部实现细节，禁止暴露给 AI。
    const changedCount = data.changedNodeRefs.length;
    if (changedCount > 0) {
      parts.push(`已更新 ${changedCount} 个节点的标签`);
      parts.push(`节点：${data.changedNodeRefs.join('、')}`);
    } else {
      parts.push('无变更');
    }

    if (data.warnings && data.warnings.length > 0) {
      parts.push(`警告：${data.warnings.join('；')}`);
    }

    return parts.join('\n') || '无变更';
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = JSON.parse(output) as { data?: TagNodeResultData };
      if (parsed.data?.changedNodeIds?.length) {
        return `已更新 ${parsed.data.changedNodeIds.length} 个节点的标签。`;
      }
      return '执行了 MindMap 更新标签工具。';
    } catch {
      return '执行 mindmap_tag_node 工具。';
    }
  }
}
