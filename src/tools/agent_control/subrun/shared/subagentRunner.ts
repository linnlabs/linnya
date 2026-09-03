/**
 * @file src/tools/agent_control/subrun/shared/subagentRunner.ts
 * @description 通用：并发运行“注册表中的子 Agent”（按 promptKey 路由）
 *
 * 中文说明（设计目标）：
 * - 业务工具经常需要“启动一个（或多个）子 agent subrun”，并把结果结构化回传给父 agent；
 * - 子 agent 的执行过程默认不进入父会话 timeline，仅通过 subrun_trace（绑定 parentToolCallId）推送给前端工具卡；
 * - 支持可选“注入父会话种子历史（inheritTurns）”，但严格只注入 user_input / final_answer（对齐 Deep Research 范式）；
 * - 支持并行：上层可用 Promise.all 同时启动多个子 agent，本模块提供批量封装；
 *
 * 重要约束：
 * - 本模块只承接会在父工具活动中展示的 child；父工具锚点或 trace publisher 缺失时必须在启动前失败；
 * - `parentToolCallId` 与 trace policy 只在这里组装，业务工具不得复制；
 * - “并发子 agent”并不等价于“并发写入”。如果多个子 agent 会写同一资源，必须在写工具层提供串行锁。
 */

import type { PromptKey } from 'src/app-hosts/linnya/agent-registry/prompt.types';
import type { ToolExecutionContext } from 'linnkit/runtime-kernel';
import type { RuntimeEvent, ToolCallId } from 'linnkit/contracts';
import { resolveRegisteredChildRunInvoker } from './childRunInvoker';

type RegisteredSubagentToolContext = ToolExecutionContext & object;

export interface RunRegisteredSubagentParams {
  context: RegisteredSubagentToolContext;
  promptKey: PromptKey;
  description: string;
  userMessage: string;
  inheritTurns: number;
  maxSteps?: number;
  /**
   * 显式锁定 child run 使用的模型。
   *
   * 系统发起的 batch 必须把父 run 当前模型透传进来，避免 `user_primary`
   * 类型的 worker 在没有 renderer 请求上下文时退回默认模型。
   */
  modelId?: string;
  subrunSource: string;
  subrunMetadata: Record<string, unknown>;
  /**
   * 显式指定 subrunId（可选）。
   *
   * 中文说明：
   * - 默认生成随机 ID；
   * - 当需要前端通过 deterministic key 关联 trace 时（例如并行子 agent），可传入 "${parentToolCallId}_${index}"。
   */
  subrunId?: string;
}

export interface RunRegisteredSubagentResult {
  runId?: string;
  parentRunId?: string;
  subrunId: string;
  success: boolean;
  cancelled?: boolean;
  finalAnswer: string;
  lastProgress?: string;
  events: RuntimeEvent[];
  stepCount: number;
  error?: string;
  judgeToolOutput?: string;
}

function requireParentTraceBinding(context: RegisteredSubagentToolContext): ToolCallId {
  const parentToolCallId = context.parentToolCallId;
  if (!parentToolCallId) {
    throw new Error('[subagentRunner] parentToolCallId is required for a visible child run');
  }
  if (typeof context.createSubRunTracePublisher !== 'function') {
    throw new Error(
      '[subagentRunner] createSubRunTracePublisher is required for a visible child run'
    );
  }
  return parentToolCallId;
}

/**
 * 运行单个注册表子 agent（按 promptKey 找 AgentDefinition）。
 */
export async function runRegisteredSubagent(
  params: RunRegisteredSubagentParams
): Promise<RunRegisteredSubagentResult> {
  const { context } = params;
  const parentToolCallId = requireParentTraceBinding(context);
  const result = await resolveRegisteredChildRunInvoker(context).invoke({
    promptKey: params.promptKey,
    userMessage: params.userMessage,
    parentToolContext: context,
    historyPolicy: {
      inheritTurns: params.inheritTurns,
    },
    tracePolicy: {
      parentToolCallId,
      subrunId: params.subrunId,
      source: params.subrunSource,
      metadata: params.subrunMetadata,
    },
    executionPolicy: {
      ...(params.maxSteps !== undefined ? { maxSteps: params.maxSteps } : {}),
      ...(params.modelId ? { modelId: params.modelId } : {}),
      abortSignal: context.abortSignal,
    },
  });

  return {
    ...(typeof result.runId === 'string' ? { runId: result.runId } : {}),
    ...(typeof result.parentRunId === 'string' ? { parentRunId: result.parentRunId } : {}),
    subrunId: result.subrunId,
    success: result.success,
    ...(result.cancelled ? { cancelled: true } : {}),
    finalAnswer: typeof result.finalAnswer === 'string' ? result.finalAnswer : '',
    ...(typeof result.lastProgress === 'string' ? { lastProgress: result.lastProgress } : {}),
    events: result.events,
    stepCount: result.stepCount,
    ...(typeof result.error === 'string' && result.error.trim().length > 0
      ? { error: result.error }
      : {}),
    ...(typeof result.judgeToolOutput === 'string'
      ? { judgeToolOutput: result.judgeToolOutput }
      : {}),
  };
}

export interface RunRegisteredSubagentsInParallelParams {
  context: RegisteredSubagentToolContext;
  subruns: Array<Omit<RunRegisteredSubagentParams, 'context'>>;
  /**
   * 最大并发数（用于批量并行，避免一次性打爆上游 rate limit）。
   *
   * 中文说明：
   * - 这里限制的是“同时 in-flight 的子 agent 数量”；
   * - 不影响结果顺序：返回数组顺序与 subruns 输入顺序严格一致；
   * - 该参数是“工程稳定性”约束，不是业务语义。
   */
  maxConcurrency?: number;
}

/**
 * 并行运行多个注册表子 agent。
 */
export async function runRegisteredSubagentsInParallel(
  params: RunRegisteredSubagentsInParallelParams
): Promise<RunRegisteredSubagentResult[]> {
  if (!Array.isArray(params.subruns) || params.subruns.length === 0) return [];

  const maxConcurrencyRaw = params.maxConcurrency;
  const maxConcurrency =
    typeof maxConcurrencyRaw === 'number' && Number.isFinite(maxConcurrencyRaw)
      ? maxConcurrencyRaw
      : params.subruns.length;
  if (maxConcurrency <= 0) {
    throw new Error(`[subagentRunner] maxConcurrency must be >= 1, got ${maxConcurrency}`);
  }

  const out: RunRegisteredSubagentResult[] = [];
  for (let i = 0; i < params.subruns.length; i += maxConcurrency) {
    const batch = params.subruns.slice(i, i + maxConcurrency);
    const batchResults = await Promise.all(
      batch.map(t =>
        runRegisteredSubagent({
          ...t,
          context: params.context,
        })
      )
    );
    out.push(...batchResults);
  }
  return out;
}
