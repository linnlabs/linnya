/**
 * @file mindmapSubagentTools.ts
 *
 * @description
 * MindMap 子 Agent 调用工具（Milestone 2）。
 *
 * 中文说明（对齐 Deep Research 范式）：
 * - 这些工具只负责“把指定 promptKey 的子 Agent 跑起来”，并把结果结构化返回；
 * - 子 Agent 的读/写图闭环仍通过其自身工具白名单完成（符合“子 agent 独立闭环写图”约束）；
 * - 工具层固定 promptKey / maxSteps / inheritTurns，避免模型侧漂移；
 * - 可选发布 subrun_trace（绑定 parentToolCallId），便于 UI 观察与回放。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '@plugin/backend/toolRuntime';
import type { StructuredToolResult } from '@plugin/backend/toolRuntime';
import type { PromptKey } from '@plugin/backend/agentRegistry';
import { MindmapPromptKeys } from '@plugin/mindmap/shared';
import { Logger } from '@plugin/backend/workspaceRuntime';
import { runRegisteredSubagent, runRegisteredSubagentsInParallel } from '@plugin/backend/toolRuntime';

const logger = new Logger('MindMapSubagentTools');

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

function normalizeNodeRef(ref: string): string {
  const s = ref.trim();
  return s.startsWith('#') ? s : `#${s}`;
}

type MindMapSubrunKind = 'decompose' | 'propose' | 'validate';

function readMindMapSubrunKind(v: unknown): MindMapSubrunKind | undefined {
  const s = readNonEmptyString(v);
  if (!s) return undefined;
  if (s === 'decompose' || s === 'propose' || s === 'validate') return s;
  return undefined;
}

function formatTargetAnchor(params: { targetNodeRefRaw?: string; targetNodeId?: string }): string {
  const { targetNodeRefRaw, targetNodeId } = params;
  if (targetNodeRefRaw) {
    // 与 BaseMindMapSubagentTool 保持一致：统一为 [#abc123]
    return `[#${normalizeNodeRef(targetNodeRefRaw).replace(/^#/, '')}]`;
  }
  return `nodeId=${targetNodeId}`;
}

function buildSubagentUserMessage(params: {
  documentId: string;
  targetAnchor: string;
  description: string;
  prompt: string;
}): string {
  // 中文说明：把 documentId + anchor 作为“稳定机器可读头部”注入给子 agent，避免 prompt 漂移导致找不到目标。
  return [
    `document_id: ${params.documentId}`,
    `target_node: ${params.targetAnchor}`,
    '',
    `任务描述: ${params.description}`,
    '',
    params.prompt,
  ].join('\n');
}

abstract class BaseMindMapSubagentTool extends BaseTool {
  abstract readonly name: string;
  abstract readonly fixedPromptKey: PromptKey;
  abstract readonly fixedMaxSteps: number;
  abstract readonly fixedInheritTurns: number;
  abstract readonly subrunSource: string;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'MindMap 文档 ID（Workspace Node ID）' },
      target_node_ref: { type: 'string', description: '目标节点短 ref（如 #k9Q2x7 或 k9Q2x7）' },
      target_node_id: { type: 'string', description: '目标节点 ID（不推荐；优先使用 target_node_ref）' },
      description: { type: 'string', description: '子任务简短描述。建议 3~20 字。' },
      prompt: { type: 'string', description: '子任务详细内容。' },
    },
    required: ['document_id', 'description', 'prompt'],
  };

  getExecutionSummary(output: string): string {
    try {
      const parsed = JSON.parse(output) as unknown;
      if (!parsed || typeof parsed !== 'object') return '子过程已执行。';
      const data = (parsed as Record<string, unknown>)['data'];
      if (!data || typeof data !== 'object') return '子过程已执行。';
      const d = data as Record<string, unknown>;
      const cancelled = d['cancelled'] === true;
      const ok = d['success'] === true;
      const desc = typeof d['description'] === 'string' ? d['description'] : '子过程';
      if (cancelled) return `${desc}：已取消。`;
      return ok ? `${desc}：完成。` : `${desc}：未完成。`;
    } catch {
      return '子过程已执行。';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const documentId = readNonEmptyString(args['document_id']);
    if (!documentId) throw new Error(`${this.name}: document_id is required`);

    const description = readNonEmptyString(args['description']);
    const prompt = readNonEmptyString(args['prompt']);
    if (!description) throw new Error(`${this.name}: description is required`);
    if (!prompt) throw new Error(`${this.name}: prompt is required`);

    const targetNodeRefRaw = readNonEmptyString(args['target_node_ref']);
    const targetNodeId = readNonEmptyString(args['target_node_id']);
    if (!targetNodeRefRaw && !targetNodeId) {
      throw new Error(`${this.name}: target_node_ref 或 target_node_id 至少提供一个`);
    }

    const targetAnchor = targetNodeRefRaw
      ? `[#${normalizeNodeRef(targetNodeRefRaw).replace(/^#/, '')}]`
      : `nodeId=${targetNodeId}`;

    // 中文说明：把 documentId + anchor 作为“稳定机器可读头部”注入给子 agent，避免 prompt 漂移导致找不到目标。
    const userMessage = [
      `document_id: ${documentId}`,
      `target_node: ${targetAnchor}`,
      '',
      `任务描述: ${description}`,
      '',
      prompt,
    ].join('\n');

    const subrunMetadata: Record<string, unknown> = {
      document_id: documentId,
      target_node_ref: targetNodeRefRaw ? normalizeNodeRef(targetNodeRefRaw) : undefined,
      target_node_id: targetNodeId,
      prompt_key: this.fixedPromptKey,
      runner_tool: this.name,
    };

    logger.info('[MindMapSubagentTools] 启动子 agent', {
      tool: this.name,
      promptKey: this.fixedPromptKey,
      documentId,
    });

    const r = await runRegisteredSubagent({
      context,
      promptKey: this.fixedPromptKey,
      description,
      userMessage,
      inheritTurns: this.fixedInheritTurns,
      maxSteps: this.fixedMaxSteps,
      subrunSource: this.subrunSource,
      subrunMetadata,
    });

    // ✅ 重要：工具输出会进入父 agent 上下文，过多元信息会浪费 token。
    // - 保留：success / final_answer / error / subrun_id（父 agent 编排所需）
    // - 可读性：保留 description，便于 UI summary 展示
    // - 其余如 documentId/target/promptKey/maxSteps 等在 tool-call 入参或 trace 中已存在，属于重复信息
    const data = {
      description,
      subrun_id: r.subrunId,
      success: r.success,
      ...(r.cancelled ? { cancelled: true } : {}),
      final_answer: r.finalAnswer,
      ...(typeof r.error === 'string' ? { error: r.error } : {}),
    };

    // observation 也会喂给父 agent：保持极短，避免重复描述
    const observation = r.cancelled
      ? '子过程已取消。'
      : r.success
        ? '子过程完成。'
        : `子过程失败：${r.error ?? 'unknown error'}`;

    const result: StructuredToolResult<typeof data> = { data, observation };
    return JSON.stringify(result, null, 2);
  }
}

/**
 * MindMap 子过程：拆解问题
 *
 * 工具名说明：
 * - 避免过长的 `mindmap_run_*` 前缀；
 * - 仍然保留 `mindmap_` 域前缀，避免与其它工具冲突。
 */
export class MindMapSubrunDecomposeTool extends BaseMindMapSubagentTool {
  readonly name = 'mindmap_subrun_decompose';
  readonly fixedPromptKey = MindmapPromptKeys.MINDMAP_DECOMPOSE_QUESTION;
  readonly fixedMaxSteps = 60;
  readonly fixedInheritTurns = 0;
  readonly subrunSource = 'mindmap_subrun_decompose';

  get description() {
    return '启动 MindMap 拆解问题子 agent（固定 promptKey=mindmap_decompose_question）。';
  }
}

/**
 * MindMap 子过程：提出假设
 */
export class MindMapSubrunProposeTool extends BaseMindMapSubagentTool {
  readonly name = 'mindmap_subrun_propose';
  readonly fixedPromptKey = MindmapPromptKeys.MINDMAP_PROPOSE_HYPOTHESIS;
  readonly fixedMaxSteps = 60;
  readonly fixedInheritTurns = 0;
  readonly subrunSource = 'mindmap_subrun_propose';

  get description() {
    return '启动 MindMap 提出假设子 agent（固定 promptKey=mindmap_propose_hypothesis）。';
  }
}

/**
 * MindMap 子过程：验证假设
 */
export class MindMapSubrunValidateTool extends BaseMindMapSubagentTool {
  readonly name = 'mindmap_subrun_validate';
  readonly fixedPromptKey = MindmapPromptKeys.MINDMAP_VALIDATE_HYPOTHESIS;
  readonly fixedMaxSteps = 80;
  readonly fixedInheritTurns = 0;
  readonly subrunSource = 'mindmap_subrun_validate';

  get description() {
    return '启动 MindMap 验证假设子 agent（固定 promptKey=mindmap_validate_hypothesis）。';
  }
}

/**
 * MindMap 子过程：并行批量运行
 *
 * 中文说明（根因级设计）：
 * - LLM 的 ToolNode 通常是“单次只执行一个 tool call”；即使父 agent 想并行，也很难在同一轮真正并发执行多个子 agent。
 * - 本工具把“并行启动多个子 agent”封装在一次 tool call 内部：Promise.all 并发执行多个 subrun。
 * - MindMap 写图冲突的根因是“版本链 CAS 并发写”；写入侧已通过 withMindMapWriteLock 做 per-document FIFO 串行化，
 *   因此允许多个子 agent 并发运行，只要写图工具都走写入锁即可（现有 mindmap_* 写工具已对齐）。
 */
export class MindMapSubrunParallelTool extends BaseTool {
  readonly name = 'mindmap_subrun_parallel';

  get description() {
    return '并行启动多个 MindMap 子 agent（decompose/propose/validate）；写入由 MindMap 写入锁串行化。';
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'MindMap 文档 ID（Workspace Node ID）' },
      max_concurrency: {
        type: 'number',
        description: '最大并发数（默认 3）。建议 1~5；过高易触发上游 rate limit/超时。',
        default: 3,
      },
      subruns: {
        type: 'array',
        description: '并行任务列表（每个任务会启动一个子 agent subrun）',
        items: {
          type: 'object',
          description: '单个并行子过程任务',
          properties: {
            kind: { type: 'string', description: "子过程类型：'decompose' | 'propose' | 'validate'" },
            target_node_ref: { type: 'string', description: '目标节点短 ref（如 #k9Q2x7 或 k9Q2x7）' },
            target_node_id: { type: 'string', description: '目标节点 ID（不推荐；优先使用 target_node_ref）' },
            description: { type: 'string', description: '子任务简短描述。建议 3~20 字。' },
            prompt: { type: 'string', description: '子任务详细内容。' },
          },
          required: ['kind', 'description', 'prompt'],
        },
      },
    },
    required: ['document_id', 'subruns'],
  };

  getExecutionSummary(output: string): string {
    try {
      const parsed = JSON.parse(output) as unknown;
      if (!isRecord(parsed)) return '并行子过程已执行。';
      const data = parsed['data'];
      if (!isRecord(data)) return '并行子过程已执行。';
      const results = data['results'];
      if (!Array.isArray(results)) return '并行子过程已执行。';
      const total = results.length;
      const ok = results.filter((x) => isRecord(x) && x['success'] === true).length;
      return `并行子过程：${ok}/${total} 完成。`;
    } catch {
      return '并行子过程已执行。';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const documentId = readNonEmptyString(args['document_id']);
    if (!documentId) throw new Error(`${this.name}: document_id is required`);

    const maxConcurrencyRaw = args['max_concurrency'];
    const maxConcurrency =
      typeof maxConcurrencyRaw === 'number' && Number.isFinite(maxConcurrencyRaw) ? maxConcurrencyRaw : 3;
    if (maxConcurrency < 1) {
      throw new Error(`${this.name}: max_concurrency must be >= 1`);
    }

    const subrunsRaw = args['subruns'];
    if (!Array.isArray(subrunsRaw) || subrunsRaw.length === 0) {
      throw new Error(`${this.name}: subruns must be a non-empty array`);
    }

    const configs: Record<MindMapSubrunKind, { promptKey: PromptKey; maxSteps: number; inheritTurns: number; source: string }> = {
      decompose: {
        promptKey: MindmapPromptKeys.MINDMAP_DECOMPOSE_QUESTION,
        maxSteps: 60,
        inheritTurns: 0,
        source: 'mindmap_subrun_parallel_decompose',
      },
      propose: {
        promptKey: MindmapPromptKeys.MINDMAP_PROPOSE_HYPOTHESIS,
        maxSteps: 60,
        inheritTurns: 0,
        source: 'mindmap_subrun_parallel_propose',
      },
      validate: {
        promptKey: MindmapPromptKeys.MINDMAP_VALIDATE_HYPOTHESIS,
        maxSteps: 80,
        inheritTurns: 0,
        source: 'mindmap_subrun_parallel_validate',
      },
    };

    const parsedSubruns = subrunsRaw.map((t, index) => {
      if (!isRecord(t)) {
        throw new Error(`${this.name}: subruns[${index}] must be an object`);
      }
      const kind = readMindMapSubrunKind(t['kind']);
      if (!kind) {
        throw new Error(`${this.name}: subruns[${index}].kind must be one of decompose/propose/validate`);
      }
      const description = readNonEmptyString(t['description']);
      const prompt = readNonEmptyString(t['prompt']);
      if (!description) throw new Error(`${this.name}: subruns[${index}].description is required`);
      if (!prompt) throw new Error(`${this.name}: subruns[${index}].prompt is required`);

      const targetNodeRefRaw = readNonEmptyString(t['target_node_ref']);
      const targetNodeId = readNonEmptyString(t['target_node_id']);
      if (!targetNodeRefRaw && !targetNodeId) {
        throw new Error(`${this.name}: subruns[${index}] 必须提供 target_node_ref 或 target_node_id`);
      }

      return {
        index,
        kind,
        description,
        prompt,
        targetNodeRefRaw,
        targetNodeId,
      };
    });

    logger.info('[MindMapSubagentTools] 启动并行子 agent', {
      tool: this.name,
      documentId,
      subrunCount: parsedSubruns.length,
    });

    const subruns = parsedSubruns.map((subrun) => {
      const cfg = configs[subrun.kind];
      const targetAnchor = formatTargetAnchor({
        targetNodeRefRaw: subrun.targetNodeRefRaw,
        targetNodeId: subrun.targetNodeId,
      });

      const userMessage = buildSubagentUserMessage({
        documentId,
        targetAnchor,
        description: subrun.description,
        prompt: subrun.prompt,
      });

      const subrunMetadata: Record<string, unknown> = {
        document_id: documentId,
        target_node_ref: subrun.targetNodeRefRaw ? normalizeNodeRef(subrun.targetNodeRefRaw) : undefined,
        target_node_id: subrun.targetNodeId,
        prompt_key: cfg.promptKey,
        runner_tool: this.name,
        subrun_kind: subrun.kind,
        subrun_index: subrun.index,
      };

      // 注入确定性 subrunId：${parentToolCallId}_${index}
      // 目的：让前端 MindMapSubrunParallelCard 能通过 subrun index 精确关联 subrun_trace bucket。
      const parentToolCallId = typeof context.parentToolCallId === 'string' ? context.parentToolCallId : undefined;
      const subrunId = parentToolCallId ? `${parentToolCallId}_${subrun.index}` : undefined;

      return {
        subrunId,
        promptKey: cfg.promptKey,
        description: subrun.description,
        userMessage,
        inheritTurns: cfg.inheritTurns,
        maxSteps: cfg.maxSteps,
        subrunSource: cfg.source,
        subrunMetadata,
        kind: subrun.kind,
      };
    });

    const rawResults = await runRegisteredSubagentsInParallel({
      context,
      subruns: subruns.map(({ kind, ...t }) => t),
      maxConcurrency,
    });

    const results = rawResults.map((r, i) => {
      const kind = subruns[i]?.kind ?? 'decompose';
      const description = subruns[i]?.description ?? '';
      return {
        kind,
        description,
        subrun_id: r.subrunId,
        success: r.success,
        ...(r.cancelled ? { cancelled: true } : {}),
        final_answer: r.finalAnswer,
        ...(typeof r.error === 'string' ? { error: r.error } : {}),
      };
    });

    const ok = results.filter((x) => x.success).length;
    const cancelled = results.filter((x) => x.cancelled).length;
    const failed = results.length - ok - cancelled;
    const total = results.length;

    // observation 会进入父 agent 上下文：保持短小
    const observation = [
      `并行子过程结束：完成 ${ok}/${total}`,
      ...(cancelled > 0 ? [`取消 ${cancelled}`] : []),
      ...(failed > 0 ? [`失败 ${failed}`] : []),
    ].join('；');
    const data = { results };
    const result: StructuredToolResult<typeof data> = { data, observation };
    return JSON.stringify(result, null, 2);
  }
}

export const mindmapSubagentToolClasses = [
  MindMapSubrunDecomposeTool,
  MindMapSubrunProposeTool,
  MindMapSubrunValidateTool,
  MindMapSubrunParallelTool,
] as const;
