/**
 * @file packages/linnkit/src/runtime-kernel/system-reminder/apply.ts
 * @description 普通 tick SystemReminder 注入引擎
 *
 * 关键约束（根因级）：
 * - 这里的注入只发生在“即将发给 LLM 的 messages”数组上
 * - 不生成 RuntimeEvent，不写入 history，不进入数据库（下一次 request 不可回放）
 * - 普通 Reminder 允许出现在 LLMRunAudit（after_context_manager）里，因为它属于本次真实输入
 * - 压缩专用 Reminder 由 Graph compaction feature 追加为末尾 user message，不经过本文件注入
 */

import type { AgentSpecSystemReminderPolicy } from '../../contracts';
import type { LlmRequestMessage } from '../../ports';
import { createSystemReminderRules } from './rules';
import { defaultSystemReminderRegistry, type SystemReminderRegistry } from './registry';
import type { SystemReminderContext, SystemReminderRule } from './types';
import { Logger } from '../../shared/logger';
import { formatSystemReminder } from './format';

const logger = new Logger('SystemReminder');

const readString = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v;
  return s.length > 0 ? s : undefined;
};

const normalizeReminderText = (raw: string): string | undefined => {
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
};

/**
 * 把一条瞬态 Reminder 追加到现有 Prompt 末尾。
 *
 * 中文备注：这是普通 tick Reminder 的既有注入方式。压缩专用控制需要严格保留
 * 原消息级前缀，因此必须新增瞬态末尾 user message，不能把控制指令并入 tool output。
 */
function appendOrdinarySystemReminder(
  llmMessages: readonly LlmRequestMessage[],
  body: string,
): LlmRequestMessage[] {
  const tag = formatSystemReminder(body);
  if (!tag || llmMessages.length === 0) return [...llmMessages];

  const lastIdx = llmMessages.length - 1;
  const last = llmMessages[lastIdx];
  const currentContent = readString(last.content) ?? '';
  const glue = currentContent.length > 0 && !currentContent.endsWith('\n') ? '\n\n' : '\n';
  const nextMessages = [...llmMessages];
  nextMessages[lastIdx] = { ...last, content: `${currentContent}${glue}${tag}` };
  return nextMessages;
}

/**
 * 将普通 system-reminder 追加到最后一条消息末尾（返回新数组，不修改原数组）
 */
export function applySystemReminders(params: {
  llmMessages: LlmRequestMessage[];
  ctx: SystemReminderContext;
  rules?: ReadonlyArray<SystemReminderRule>;
  policy?: AgentSpecSystemReminderPolicy;
  registry?: SystemReminderRegistry;
  /**
   * 🔔 命中回调：仅当本次确实发生注入时触发
   *
   * 中文备注：
   * - 用于“审计增强”：在 after_context_manager 覆盖写语义下，仍能保留命中时刻的快照；
   * - 回调只传递最小信息（ruleIds），避免额外依赖和体积膨胀。
   */
  onInjected?: (info: { ruleIds: string[] }) => void;
}): LlmRequestMessage[] {
  const { llmMessages, ctx } = params;
  const policy = params.policy ?? ctx.executorLocal?.systemReminderPolicy;
  const rules = params.rules ?? createSystemReminderRules({
    policy,
    registry: params.registry ?? defaultSystemReminderRegistry,
  });

  if (llmMessages.length === 0) return llmMessages;

  // 1) 计算本 tick 的提醒文本列表
  const seenRuleIds = new Set<string>();
  const injectedRuleIds: string[] = [];
  const texts: string[] = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    if (typeof rule.id !== 'string' || rule.id.trim().length === 0) continue;
    if (seenRuleIds.has(rule.id)) continue;

    let hit = false;
    try {
      hit = rule.when(ctx);
    } catch {
      hit = false;
    }
    if (!hit) continue;

    seenRuleIds.add(rule.id);
    try {
      const built = rule.build(ctx);
      const normalized = normalizeReminderText(built);
      if (normalized) {
        injectedRuleIds.push(rule.id);
        texts.push(normalized);
      }
    } catch {
      // 中文备注：规则必须是纯函数且可控；这里不做“推测性兜底”，失败就跳过该规则
    }
  }

  if (texts.length === 0) return llmMessages;

  // 2) 组装一个标签块（多条提醒合并到同一个 <system-reminder> 中）
  const body = texts.map((t) => `- ${t.replace(/\n/g, '\n  ')}`).join('\n');
  const nextMessages = appendOrdinarySystemReminder(llmMessages, body);

  /**
   * ✅ 轻量审计日志（方案 B）
   *
   * 中文备注（根因级）：
   * - after_context_manager 审计点只保留“最后一次 messages”，中途注入可能被覆盖；
   * - 因此这里在“确实发生注入”时打一条极简日志，便于确认触发时机（例如第 10 次 tool_calls）。
   * - 严格限制输出体积：只输出 ruleId 列表与少量 executorLocal 关键字段，避免每次 request 都刷屏。
   */
  if (typeof params.onInjected === 'function') {
    try {
      params.onInjected({ ruleIds: injectedRuleIds });
    } catch {
      // 中文备注：回调是可选扩展点；失败不应影响主链路
    }
  }
  logger.info('SystemReminder 已注入到 LLM 输入末尾', {
    ruleIds: injectedRuleIds.length > 0 ? injectedRuleIds : Array.from(seenRuleIds),
    promptKey: ctx.request.promptKey,
    executorLocal: {
      phase: ctx.executorLocal?.phase,
      stepCount: ctx.executorLocal?.stepCount,
      maxSteps: ctx.executorLocal?.maxSteps,
      remainingSteps: ctx.executorLocal?.remainingSteps,
      finalStepPolicy: ctx.executorLocal?.finalStepPolicy,
      lastStepsHintThreshold: ctx.executorLocal?.lastStepsHintThreshold,
    },
  });
  return nextMessages;
}
