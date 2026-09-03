/**
 * @file MindMapAttachEvidenceTool.ts
 * @description MindMap 证据挂载工具 - 仅接受知识库引用 refs，确定性回填 title/snippet
 *
 * 中文说明：
 * - 模型只需输出 [@ref] 和节点 ref，工具端从 SoT 确定性回填 snippet/title/sourceId
 * - 杜绝模型编造引用内容（snippet/title 等全部来自知识库 SoT）
 * - 支持批量挂载：一次调用可给多个节点挂证据
 * - 写入 mindmap_evidence 卫星表（不修改节点属性、不影响版本号）
 *
 * @see packages/plugins/mindmap/src/renderer/docs/README.md
 */

import {
  BaseTool,
  type PluginDocumentSoT,
  type StructuredToolResult,
  type ToolContext,
  type ToolParameterSchema,
} from '@plugin/backend/toolRuntime';
import { MindMapEvidenceService } from '../../persistence/mindmap_document/services/blocks/evidence.service';
import {
  initMindMapDocContextWithoutVersionCheck,
  findNode,
  type MindMapNodeObj
} from './mindmapToolUtils';
import {
  createCitationSourceResolver,
  normalizeCitationRef,
  type PluginKnowledgeCitationSource,
} from '@plugin/backend/citationSourceRuntime';
import { sliceTextByUnitsZhEn } from '@plugin/backend/textUnitRuntime';
import { requireMindMapSqliteDatabase } from '../../persistence/ports/sqliteDatabasePort';

// ============================================================================
// 类型定义
// ============================================================================

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s.length > 0 ? s : undefined;
}

/**
 * 批量输入中每个节点的证据条目
 */
interface NodeEvidenceInput {
  /** 节点短 ref（如 #k9Q2x7 或 k9Q2x7） */
  nodeRef?: string;
  /** 知识库引用 refs（[@XXXXXX]/@XXXXXX/XXXXXX 格式） */
  refs: string[];
  /** 关联理由（可选，便于理解为什么挂这条证据） */
  note?: string;
  /** 排序起始值（可选，越小越靠前） */
  orderIndex?: number;
}

/**
 * Citation 快照（MindMapAttachEvidenceTool 输出口径）
 *
 * 中文说明：
 * - 该结构与 editor 侧 CitationNodeAttrs 的核心字段保持一致（sourceType/sourceId/title/snippet/...）；
 * - 额外补充 docId/blockId，便于调用方做 KB SoT 级回溯定位；
 * - `ref` 使用稳定短引用 token（不含 [@ ] 外壳），避免重复解析。
 */
interface MindMapCitationSnapshot {
  sourceType: 'knowledge_base';
  sourceId: string;
  ref: string;
  title: string;
  snippet: string;
  url?: string;
  authors?: string[];
  date?: string;
  containerTitle?: string;
  note?: string;
  docId: string;
  blockId: string;
}

/**
 * 单条证据挂载结果
 */
interface AttachResult {
  nodeRef?: string;
  nodeId: string;
  /** 节点内容（topic），用于 UI 一行省略展示 */
  topic?: string;
  /** 知识库引用 ref */
  ref?: string;
  /** 与统一 CitationSnapshot 语义对齐的快照（成功时必有） */
  citation?: MindMapCitationSnapshot;
  evidenceId?: string;
  status: 'attached' | 'failed';
  message?: string;
}

/**
 * 工具返回数据
 */
interface AttachEvidenceResultData {
  documentId: string;
  /** 文档名称（workspace_nodes.name），用于 UI 标题展示 */
  documentName: string;
  attachedCount: number;
  failedCount: number;
  results: AttachResult[];
  warnings?: string[];
}

/** SoT 片段截断上限（中英混合单位） */
const SNIPPET_MAX_UNITS = 500;

// ============================================================================
// 工具实现
// ============================================================================

export class MindMapAttachEvidenceTool extends BaseTool {
  readonly name = 'mindmap_attach_evidence';

  get description() {
    return [
      '将知识库引用证据挂载到 MindMap 节点上。',
      '',
      '使用场景：',
      '- 将驳斥/支持证据挂到对应节点',
      '- 记录分析过程中发现的相关知识库材料',
      '',
      '重要约束：',
      '- 只接受知识库 citation refs（[@XXXXXX]），必须来自之前 knowledge_search/knowledge_read 的输出',
      '- 禁止自行编写 snippet/title，工具会从知识库 SoT 确定性回填',
      '- 支持批量：一次调用可给多个节点分别挂多条证据',
      '',
      '参数说明：',
      '- document_id：MindMap 文档 ID',
      '- evidences：批量条目数组，每条包含 node_ref（目标节点）+ refs（知识库引用列表）+ 可选 note（关联理由）',
      '',
      '注意：证据写入 mindmap_evidence 卫星表，不影响 MindMap 版本号'
    ].join('\n');
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'MindMap 文档 ID'
      },
      evidences: {
        type: 'array',
        description: '批量挂载证据列表（每条对应一个节点 + 一组知识库引用）',
        items: {
          type: 'object',
          description: '单个节点的证据挂载条目',
          properties: {
            node_ref: {
              type: 'string',
              description: '目标节点短 ref（如 #k9Q2x7 或 k9Q2x7）'
            },
            refs: {
              type: 'array',
              description: '知识库 citation ref 列表（[@XXXXXX]/@XXXXXX/XXXXXX 格式），必须来自工具输出',
              items: { type: 'string', description: 'Citation ref token like [@ABC123]' }
            },
            note: {
              type: 'string',
              description: '关联理由（可选，建议提供，便于理解为什么挂这条证据）'
            },
            order_index: {
              type: 'integer',
              description: '排序起始值（可选，越小越靠前）'
            }
          },
          required: ['node_ref', 'refs']
        }
      }
    },
    required: ['document_id', 'evidences']
  };

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    // 1. 参数校验
    const documentId = args.document_id;
    if (typeof documentId !== 'string' || documentId.trim().length === 0) {
      throw new Error('document_id 必须是非空字符串');
    }

    // 2. 解析批量证据列表
    const evidenceInputs = this.parseEvidences(args);
    if (evidenceInputs.length === 0) {
      throw new Error('未提供有效的证据条目（需要 evidences 数组，每条包含 node_ref + refs）');
    }

    // 3. 收集所有 refs 并统一解析为 (docId, blockId)
    const allRefs = new Set<string>();
    for (const entry of evidenceInputs) {
      for (const r of entry.refs) {
        allRefs.add(r);
      }
    }
    if (allRefs.size === 0) {
      throw new Error('evidences 中未包含任何知识库引用 ref');
    }

    const canonicalRefs = Array.from(new Set(Array.from(allRefs, rawRef => {
      const ref = normalizeCitationRef(rawRef);
      if (!ref) throw new Error(`非法 ref 格式：${rawRef}`);
      return ref;
    })));
    const citationSources = await createCitationSourceResolver(context).resolveSources(canonicalRefs);
    const nonKnowledgeSource = citationSources.find(source => source.sourceType !== 'knowledge_base');
    if (nonKnowledgeSource) {
      throw new Error(`MindMap 证据挂载只接受 Knowledge 引用：[@${nonKnowledgeSource.ref}]`);
    }

    // Citation Host port 已完成 ref 接纳与冲突检查；插件只消费 Knowledge 来源身份。
    const refBlockMap = new Map<string, PluginKnowledgeCitationSource>();
    for (const source of citationSources) {
      if (source.sourceType === 'knowledge_base') {
        refBlockMap.set(source.ref, source);
      }
    }

    // 4. 获取数据库服务
    const databaseService = context.databaseService;
    if (!databaseService) {
      throw new Error('工作区数据库不可用：工具上下文缺少 databaseService。');
    }

    const db = requireMindMapSqliteDatabase(databaseService.getDb(), 'evidence attachment');
    const evidenceService = new MindMapEvidenceService(db);

    // 5. 初始化 MindMap 文档上下文（不校验版本）
    const ctxResult = initMindMapDocContextWithoutVersionCheck(documentId, context);
    if (!ctxResult.success) {
      throw new Error(ctxResult.error);
    }
    const ctx = ctxResult.ctx;

    // 6. 从知识库 SoT 确定性回填 title/snippet
    const knowledgeBaseService = context.knowledgeBaseService;
    if (!knowledgeBaseService) {
      throw new Error('[MindMapAttachEvidenceTool] 缺少 context.knowledgeBaseService，无法从 SoT 回填证据内容');
    }

    // SoT 缓存（同一文档多个 block 只读一次）
    const sotCache = new Map<string, PluginDocumentSoT>();
    const docNameCache = new Map<string, string>();

    const warnings: string[] = [];
    const results: AttachResult[] = [];
    let attachedCount = 0;
    let failedCount = 0;

    for (const entry of evidenceInputs) {
      // 查找目标节点
      const findResult = findNode(ctx.nodeData, ctx.allNodeIds, entry.nodeRef, undefined);
      if (!findResult.success || !findResult.nodeId) {
        // 节点未找到 → 该条目下所有 ref 都标记失败
        for (const refRaw of entry.refs) {
          results.push({
            nodeRef: entry.nodeRef,
            nodeId: '',
            status: 'failed',
            message: findResult.error || '节点未找到'
          });
          failedCount++;
        }
        continue;
      }

      const nodeId = findResult.nodeId;
      const nodeRef = ctx.refMap.get(nodeId);
      const topic = findResult.node && typeof findResult.node.topic === 'string'
        ? findResult.node.topic.trim()
        : undefined;

      // 逐条 ref 挂载证据
      for (let i = 0; i < entry.refs.length; i++) {
        const rawRef = entry.refs[i];
        // 归一化 ref 以匹配 refBlockMap
        const normalizedRef = normalizeCitationRef(rawRef);
        if (!normalizedRef) {
          results.push({
            nodeRef,
            nodeId,
            topic,
            ref: rawRef,
            status: 'failed',
            message: `非法 ref 格式：${rawRef}`
          });
          failedCount++;
          continue;
        }

        const block = refBlockMap.get(normalizedRef);
        if (!block) {
          results.push({
            nodeRef,
            nodeId,
            topic,
            ref: rawRef,
            status: 'failed',
            message: `ref ${rawRef} 未能解析为知识库指针`
          });
          failedCount++;
          continue;
        }

        try {
          // 从 SoT 读取 block 内容（确定性回填 snippet/title）
          let sot = sotCache.get(block.docId);
          if (!sot) {
            const sotResult = await knowledgeBaseService.getRawSoTDocument(block.docId);
            if (!sotResult) {
              results.push({
                nodeRef,
                nodeId,
                topic,
                ref: rawRef,
                status: 'failed',
                message: `知识库文档不存在：doc_id="${block.docId}"`
              });
              failedCount++;
              continue;
            }
            sot = sotResult;
            sotCache.set(block.docId, sot);
          }

          const contentBlock = sot.content_blocks?.[block.blockId];
          if (!contentBlock) {
            results.push({
              nodeRef,
              nodeId,
              topic,
              ref: rawRef,
              status: 'failed',
              message: `知识库 block 不存在：doc_id="${block.docId}" block_id="${block.blockId}"`
            });
            failedCount++;
            continue;
          }

          // 确定性获取 title
          if (!docNameCache.has(block.docId)) {
            try {
              const meta = await knowledgeBaseService.getDocumentById(block.docId);
              docNameCache.set(block.docId, meta?.filename ?? block.docId);
            } catch {
              docNameCache.set(block.docId, block.docId);
            }
          }
          const title = docNameCache.get(block.docId) ?? block.docId;

          // 确定性截断 snippet
          const rawText = typeof contentBlock.text === 'string' ? contentBlock.text : '';
          const snippet = sliceTextByUnitsZhEn(rawText, SNIPPET_MAX_UNITS);

          // sourceId 对齐 ReferenceInsertPanel.vue 的约定：docId#blockId
          const sourceId = `${block.docId}#${block.blockId}`;

          // 计算 orderIndex
          const orderIndex = entry.orderIndex !== undefined ? entry.orderIndex + i : undefined;

          // 写入 mindmap_evidence 卫星表
          const created = evidenceService.addEvidence({
            documentId,
            mindmapNodeId: nodeId,
            sourceType: 'knowledge_base',
            sourceId,
            // 中文说明（根因级修复）：
            // - mindmap_evidence.ref 在同一 document_id 下要求唯一；
            // - KB 的 citation ref（[@XXXXXX]）需要允许“同一证据挂到多个节点”，因此不能写入 ref 字段；
            // - SoT 定位使用 sourceId=docId#blockId，引用外观仅用于 tool_output 展示（见 results[].ref）。
            title,
            snippet,
            note: entry.note,
            orderIndex,
          });

          const citationSnapshot: MindMapCitationSnapshot = {
            sourceType: 'knowledge_base',
            sourceId: created.sourceId,
            ref: normalizedRef,
            title: created.title ?? title,
            snippet: created.snippet ?? snippet,
            url: created.url,
            authors: created.authors,
            date: created.date,
            containerTitle: created.containerTitle,
            note: created.note,
            docId: block.docId,
            blockId: block.blockId,
          };

          results.push({
            nodeRef,
            nodeId,
            topic,
            ref: `[@${normalizedRef}]`,
            citation: citationSnapshot,
            evidenceId: created.id,
            status: 'attached',
            message: `已挂载 [@${normalizedRef}] 到 ${nodeRef || nodeId}`
          });
          attachedCount++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          results.push({
            nodeRef,
            nodeId,
            topic,
            ref: rawRef,
            status: 'failed',
            message: errMsg
          });
          failedCount++;
        }
      }
    }

    // 7. 构建返回
    const data: AttachEvidenceResultData = {
      documentId,
      documentName: ctx.documentName,
      attachedCount,
      failedCount,
      results,
      warnings: warnings.length > 0 ? warnings : undefined
    };

    const observation = this.buildObservation(data);

    const result: StructuredToolResult<AttachEvidenceResultData> = { data, observation };
    return JSON.stringify(result, null, 2);
  }

  /**
   * 解析批量证据列表
   */
  private parseEvidences(args: Record<string, unknown>): NodeEvidenceInput[] {
    if (!Array.isArray(args.evidences)) return [];

    return args.evidences
      .filter(isRecord)
      .map((ev) => ({
        nodeRef: readString(ev.node_ref),
        refs: Array.isArray(ev.refs) ? ev.refs.filter((r): r is string => typeof r === 'string') : [],
        note: readString(ev.note),
        orderIndex: typeof ev.order_index === 'number' && Number.isFinite(ev.order_index)
          ? ev.order_index
          : undefined
      }))
      .filter((ev) => ev.nodeRef && ev.refs.length > 0);
  }

  private buildObservation(data: AttachEvidenceResultData): string {
    const parts: string[] = [];

    if (data.attachedCount > 0) {
      parts.push(`已挂载 ${data.attachedCount} 条证据`);
    }
    if (data.failedCount > 0) {
      parts.push(`失败 ${data.failedCount} 条`);
    }

    // 列出成功的节点 + ref（限制条数，避免批量刷屏）
    const successItems = data.results
      .filter((r) => r.status === 'attached')
      .map((r) => `${r.nodeRef || r.nodeId}←${r.ref || '?'}`)
      .slice(0, 5);
    if (successItems.length > 0) parts.push(`成功：${successItems.join('、')}`);

    // 列出失败原因预览（同样限制条数）
    const failedItems = data.results
      .filter((r) => r.status === 'failed')
      .map((r) => `${r.nodeRef || r.nodeId}（${r.ref || '?'}）：${r.message || '失败'}`)
      .slice(0, 3);
    if (failedItems.length > 0) parts.push(`失败原因：${failedItems.join('；')}`);

    if (data.warnings && data.warnings.length > 0) {
      parts.push(`警告：${data.warnings.join('；')}`);
    }

    return parts.join('\n') || '无操作';
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = JSON.parse(output) as { data?: AttachEvidenceResultData };
      const attached = parsed.data?.attachedCount ?? 0;
      const failed = parsed.data?.failedCount ?? 0;
      if (attached > 0 && failed > 0) return `已挂载 ${attached} 条，失败 ${failed} 条。`;
      if (attached > 0) return `已挂载 ${attached} 条知识库证据。`;
      if (failed > 0) return `挂载失败 ${failed} 条。`;
      return '无操作。';
    } catch {
      return '执行 mindmap_attach_evidence 工具。';
    }
  }
}
