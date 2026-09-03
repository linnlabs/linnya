/**
 * @file packages/linnkit/src/runtime-kernel/system-reminder/types.ts
 * @description SystemReminder（系统提醒）类型定义
 *
 * 设计目标（必须遵守）：
 * - ✅ 只对“当前 tick / 当前 request”生效：不写入 history，不转换成 RuntimeEvent，不进入持久化
 * - ✅ 配置驱动：新增/调整提醒只改 rules 配置文件
 * - ✅ 普通 tick 注入：追加到最后一条 message.content，继承该消息 role
 * - ✅ 压缩专用注入：完整原 Prompt 后新增瞬态 user message；不由本规则模块构造
 * - ❌ System Reminder 标签不代表独立 system-role message
 */

import type { AgentInvocationRequest } from '../../ports';
import type { ExecutorLocalState } from '../graph-engine/types';
import type { AgentSpecSystemReminderExtraRule, AgentSpecSystemReminderTrigger, RuntimeEvent } from '../../contracts';

export interface SystemReminderContext {
  request: AgentInvocationRequest;
  history: ReadonlyArray<RuntimeEvent>;
  /**
   * 执行阶段信号（由 GraphExecutor 注入）
   * - stepCount/maxSteps/remainingSteps/phase/finalStepPolicy...
   */
  executorLocal?: ExecutorLocalState;
}

export interface SystemReminderRule {
  /**
   * 规则唯一 ID（用于本 tick 内去重与调试定位）
   */
  id: string;

  /**
   * 是否触发
   */
  when: (ctx: SystemReminderContext) => boolean;

  /**
   * 构建提醒正文（不包含外层 <system-reminder> 标签）
   */
  build: (ctx: SystemReminderContext) => string;
}

export type SystemReminderTriggerEvaluator = (
  ctx: SystemReminderContext,
  trigger: AgentSpecSystemReminderTrigger,
) => boolean;

export type SystemReminderContentTemplate = (
  ctx: SystemReminderContext,
  args: Record<string, unknown> | undefined,
) => string;

export interface SystemReminderRuleDefinition extends AgentSpecSystemReminderExtraRule {}
