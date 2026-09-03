import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { CommandToolOutputDisplay } from '@app/schemas/commands';

import type { BaseMessage, ToolCallMessage } from '../../../types';
import type {
  ProcessCommandExecutionPresentationData,
  ShellCommandExecutionPresentationData,
} from '../definitions/commandExecutionPresentation';
import type { CommandExecutionPresentationData } from '../definitions/commandExecutionPresentation';
import { isRecord } from '../../../utils/typeGuards';

function isCommandExecutionPresentationData(
  value: unknown
): value is ShellCommandExecutionPresentationData | ProcessCommandExecutionPresentationData {
  if (!isRecord(value) || value['kind'] !== 'command_execution') return false;
  if (value['source'] === 'shell') {
    return typeof value['command'] === 'string' && typeof value['interactive'] === 'boolean';
  }
  return (
    value['source'] === 'process' &&
    typeof value['processHandle'] === 'string' &&
    typeof value['action'] === 'string' &&
    (value['effect'] === 'pending' ||
      value['effect'] === 'observation' ||
      value['effect'] === 'control_accepted' ||
      value['effect'] === 'rejected')
  );
}

function readCommandPresentation(
  message: BaseMessage
): ToolCardPresentation<
  ShellCommandExecutionPresentationData | ProcessCommandExecutionPresentationData
> | null {
  if (message.type !== 'tool_calls') return null;
  const presentation = message.toolPresentation;
  if (presentation?.uiKey !== 'shell' && presentation?.uiKey !== 'process') return null;
  // 外层工具失败由通用 ToolErrorCard 展示，不能把失败的 process 控制调用吞进原 Shell 卡片。
  if (presentation.status === 'error') return null;
  if (!isCommandExecutionPresentationData(presentation.data)) return null;
  return { ...presentation, data: presentation.data };
}

function aggregationKey(runId: string, processHandle: string): string {
  return `${runId}\u0000${processHandle}`;
}

function mergeProcessDisplay(
  shellDisplay: CommandToolOutputDisplay | undefined,
  processDisplay: CommandToolOutputDisplay | undefined
): CommandToolOutputDisplay | undefined {
  if (!processDisplay) return shellDisplay;
  if (
    processDisplay.mode === 'pty' &&
    shellDisplay?.mode === 'pty' &&
    !processDisplay.screen &&
    shellDisplay.screen
  ) {
    // poll/wait 只投影本次新增输出；终态没有新增 byte 时不会重复携带 screen。
    // 这里保留最近一次有效屏幕，但覆盖范围、输出阶段等事实仍采用最新 observation。
    return { ...processDisplay, screen: shellDisplay.screen };
  }
  return processDisplay;
}

function mergeProcessUpdate(
  shell: ShellCommandExecutionPresentationData,
  process: ProcessCommandExecutionPresentationData
): ShellCommandExecutionPresentationData {
  const executionFacts =
    process.auditStatus === 'incomplete' && shell.executionFacts
      ? { ...shell.executionFacts, audit_status: 'incomplete' as const }
      : shell.executionFacts;
  if (process.effect === 'rejected') {
    return {
      ...shell,
      ...(executionFacts ? { executionFacts } : {}),
      lastProcessAction: process.action,
      lastProcessRejectionCode: process.rejectionCode,
    };
  }
  if (process.effect === 'pending' || process.effect === 'control_accepted') {
    return {
      ...shell,
      ...(executionFacts ? { executionFacts } : {}),
      lastProcessAction: process.action,
    };
  }
  const display = mergeProcessDisplay(shell.display, process.display);
  const observedExecutionFacts = process.executionFacts
    ? {
        ...process.executionFacts,
        ...(shell.executionFacts?.permission
          ? { permission: shell.executionFacts.permission }
          : {}),
      }
    : shell.executionFacts;
  return {
    ...shell,
    state: process.state,
    observation: process.observation || shell.observation,
    ...(display ? { display } : {}),
    ...(process.terminal ? { terminal: process.terminal } : {}),
    ...(process.nextCursor !== undefined ? { nextCursor: process.nextCursor } : {}),
    ...(observedExecutionFacts ? { executionFacts: observedExecutionFacts } : {}),
    incomplete: shell.incomplete || process.incomplete,
    incompleteReasons: Array.from(
      new Set([...shell.incompleteReasons, ...process.incompleteReasons])
    ),
    lastProcessAction: process.action,
    lastProcessRejectionCode: undefined,
  };
}

/**
 * `process` 是控制调用，不是第二个后台任务。窗口历史与 live 消息合并后都走这一个纯派生：
 * 能找到同 run 的 opaque handle 时更新原 shell 卡片；窗口暂缺源卡片时保留 process 卡片，
 * 避免分页边界静默吞掉用户可见事实。底层 durable message 和 tool metadata 均不修改。
 */
export function aggregateCommandExecutionMessages(messages: readonly BaseMessage[]): BaseMessage[] {
  const output: BaseMessage[] = [];
  const shellIndexByHandle = new Map<string, number>();

  for (const message of messages) {
    const presentation = readCommandPresentation(message);
    if (!presentation || message.type !== 'tool_calls') {
      output.push(message);
      continue;
    }
    const data = presentation.data;
    if (data.source === 'shell') {
      const outputIndex = output.length;
      output.push(message);
      if (data.processHandle) {
        shellIndexByHandle.set(
          aggregationKey(message.metadata.run_id, data.processHandle),
          outputIndex
        );
      }
      continue;
    }

    const shellIndex = shellIndexByHandle.get(
      aggregationKey(message.metadata.run_id, data.processHandle)
    );
    const shellMessage = shellIndex === undefined ? undefined : output[shellIndex];
    const shellPresentation = shellMessage ? readCommandPresentation(shellMessage) : null;
    if (
      shellIndex === undefined ||
      !shellMessage ||
      shellMessage.type !== 'tool_calls' ||
      !shellPresentation ||
      shellPresentation.data.source !== 'shell'
    ) {
      output.push(message);
      continue;
    }

    const mergedData = mergeProcessUpdate(shellPresentation.data, data);
    const mergedPresentation: ToolCardPresentation<CommandExecutionPresentationData> = {
      ...shellPresentation,
      status: message.metadata.status,
      phase: message.metadata.phase,
      data: mergedData,
    };
    const mergedMessage: ToolCallMessage = {
      ...shellMessage,
      timestamp: message.timestamp,
      toolPresentation: mergedPresentation,
    };
    output[shellIndex] = mergedMessage;
  }

  return output;
}
