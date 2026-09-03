import {
  ProcessToolArgumentsV1Schema,
  ProcessToolStructuredResultSchema,
  CommandProcessHandleSchema,
  ShellToolArgumentsV1Schema,
  ShellToolStructuredResultSchema,
  type CommandOutputIncompleteReason,
  type CommandProcessHandle,
  type CommandToolOutputDisplay,
  type ProcessToolStructuredResult,
  type ShellToolStructuredResult,
} from '@app/schemas/commands';
import type {
  ToolCompactStepPresentation,
  ToolCompactStepProjectorInput,
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '@linnya/plugin-host-contract/renderer/toolUi';

import type {
  CommandExecutionPresentationData,
  CommandExecutionLifecyclePresentationData,
  ProcessCommandExecutionPresentationData,
  ShellCommandExecutionPresentationData,
} from '../definitions/commandExecutionPresentation';
import { isRecord } from '../../../utils/typeGuards';
import { createConversationToolLocalizedTextDescriptor } from '../../../ui/tools/functions/createConversationToolTitleDescriptor';

const PROCESS_COMPACT_TITLE_KEYS = {
  poll: 'conversation.tool.command.compact.process.poll',
  wait: 'conversation.tool.command.compact.process.wait',
  cancel: 'conversation.tool.command.compact.process.cancel',
  write: 'conversation.tool.command.compact.process.write',
  submit: 'conversation.tool.command.compact.process.submit',
  eof: 'conversation.tool.command.compact.process.eof',
  resize: 'conversation.tool.command.compact.process.resize',
} as const;

export function projectCommandExecutionCompactStep(
  input: ToolCompactStepProjectorInput,
): ToolCompactStepPresentation {
  if (input.sourceToolName === 'shell' && input.uiKey === 'shell') {
    if (input.status === 'error') {
      return {
        title: createConversationToolLocalizedTextDescriptor(
          'conversation.tool.command.failed',
        ),
      };
    }
    if (input.status === 'loading') {
      const lifecycleArgs = readShellLifecycleArguments(input.args);
      return {
        title: lifecycleArgs
          ? createConversationToolLocalizedTextDescriptor(
              'conversation.tool.command.compact.shell',
              { command: lifecycleArgs.command },
            )
          : createConversationToolLocalizedTextDescriptor(
              'conversation.tool.command.running',
            ),
      };
    }
    const args = ShellToolArgumentsV1Schema.parse(input.args);
    ShellToolStructuredResultSchema.parse(input.result);
    return {
      title: createConversationToolLocalizedTextDescriptor(
        'conversation.tool.command.compact.shell',
        { command: args.command },
      ),
    };
  }
  if (input.sourceToolName === 'process' && input.uiKey === 'process') {
    if (input.status === 'error') {
      return {
        title: createConversationToolLocalizedTextDescriptor(
          'conversation.tool.command.failed',
        ),
      };
    }
    if (input.status === 'loading') {
      const action = readProcessCompactAction(input.args);
      return {
        title: action
          ? createConversationToolLocalizedTextDescriptor(PROCESS_COMPACT_TITLE_KEYS[action])
          : createConversationToolLocalizedTextDescriptor(
              'conversation.tool.command.running',
            ),
      };
    }
    const args = ProcessToolArgumentsV1Schema.parse(input.args);
    ProcessToolStructuredResultSchema.parse(input.result);
    return {
      title: createConversationToolLocalizedTextDescriptor(
        PROCESS_COMPACT_TITLE_KEYS[args.action.type],
      ),
    };
  }
  throw new Error(
    `Unsupported command compact step: source=${input.sourceToolName}, uiKey=${input.uiKey}`,
  );
}

function readProcessCompactAction(
  value: unknown,
): keyof typeof PROCESS_COMPACT_TITLE_KEYS | undefined {
  if (!isRecord(value) || !isRecord(value['action'])) return undefined;
  const type = value['action']['type'];
  if (typeof type !== 'string' || !isProcessCompactAction(type)) return undefined;
  return type;
}

function isProcessCompactAction(
  value: string,
): value is keyof typeof PROCESS_COMPACT_TITLE_KEYS {
  return Object.prototype.hasOwnProperty.call(PROCESS_COMPACT_TITLE_KEYS, value);
}

interface ShellArguments {
  readonly command: string;
  readonly cwd?: string;
  readonly interactive: boolean;
}

interface ProcessArguments {
  readonly processHandle: CommandProcessHandle;
  readonly action: string;
}

function readShellArguments(value: unknown): ShellArguments {
  const args = readShellLifecycleArguments(value);
  if (!args) throw new Error('shell 工具展示缺少有效参数');
  return args;
}

function readShellLifecycleArguments(value: unknown): ShellArguments | undefined {
  const args = isRecord(value) ? value : null;
  if (!args || typeof args['command'] !== 'string' || args['command'].trim().length === 0) {
    return undefined;
  }
  const cwd = args['cwd'];
  const interactive = args['interactive'];
  if (cwd !== undefined && typeof cwd !== 'string') {
    return undefined;
  }
  if (interactive !== undefined && typeof interactive !== 'boolean') {
    return undefined;
  }
  return {
    command: args['command'],
    ...(cwd ? { cwd } : {}),
    interactive: interactive === true,
  };
}

function readProcessArguments(value: unknown): ProcessArguments {
  const args = readProcessLifecycleArguments(value);
  if (!args) throw new Error('process 工具展示缺少有效参数');
  return args;
}

function readProcessLifecycleArguments(value: unknown): ProcessArguments | undefined {
  const args = isRecord(value) ? value : null;
  const action = isRecord(args?.['action']) ? args['action'] : null;
  if (!args || typeof args['process_handle'] !== 'string' || !action) {
    return undefined;
  }
  if (typeof action['type'] !== 'string') {
    return undefined;
  }
  const processHandle = CommandProcessHandleSchema.safeParse(args['process_handle']);
  if (!processHandle.success) return undefined;
  return {
    processHandle: processHandle.data,
    action: action['type'],
  };
}

function projectLifecycle(
  source: 'shell' | 'process',
  status: 'loading' | 'error',
  toolCallId: string | undefined
): CommandExecutionLifecyclePresentationData {
  return {
    kind: 'command_execution_lifecycle',
    source,
    state: status === 'loading' ? 'starting' : 'failed',
    toolCallId,
    observation: '',
    incomplete: false,
    incompleteReasons: [],
  };
}

function readIncompleteReasons(
  display: CommandToolOutputDisplay | undefined
): readonly CommandOutputIncompleteReason[] {
  if (!display) return [];
  if (display.incompleteReasons) return display.incompleteReasons;
  // 旧 durable row 没有显式 reasons，但这两个字段本身就是稳定事实。兼容投影只做
  // 一一对应，不读取正文猜测，也不把旧消息创建时间冒充执行时间。
  const reasons: CommandOutputIncompleteReason[] = [];
  if (display.coverage === 'omitted') reasons.push('retained_window_omitted');
  if (display.textProjection === 'failed') reasons.push('text_projection_failed');
  return reasons;
}

function isIncomplete(display: CommandToolOutputDisplay | undefined): boolean {
  return readIncompleteReasons(display).length > 0;
}

function projectShellResult(
  args: ShellArguments,
  result: ShellToolStructuredResult,
  toolCallId: string | undefined
): ShellCommandExecutionPresentationData {
  const data = result.data;
  if (data.status === 'running') {
    return {
      kind: 'command_execution',
      source: 'shell',
      state: 'running',
      toolCallId,
      command: args.command,
      ...(args.cwd ? { cwd: args.cwd } : {}),
      interactive: args.interactive,
      processHandle: data.processHandle,
      nextCursor: data.nextCursor,
      observation: data.presentationText,
      display: data.display,
      ...(data.presentation ? { executionFacts: data.presentation } : {}),
      incomplete: isIncomplete(data.display),
      incompleteReasons: readIncompleteReasons(data.display),
    };
  }
  if (data.status === 'completed') {
    return {
      kind: 'command_execution',
      source: 'shell',
      state: 'completed',
      toolCallId,
      command: args.command,
      ...(args.cwd ? { cwd: args.cwd } : {}),
      interactive: args.interactive,
      observation: data.presentationText,
      ...(data.display ? { display: data.display } : {}),
      ...(data.presentation ? { executionFacts: data.presentation } : {}),
      terminal: data.terminal,
      incomplete: isIncomplete(data.display),
      incompleteReasons: readIncompleteReasons(data.display),
    };
  }
  return {
    kind: 'command_execution',
    source: 'shell',
    state: 'rejected',
    toolCallId,
    command: args.command,
    ...(args.cwd ? { cwd: args.cwd } : {}),
    interactive: args.interactive,
    observation: data.presentationText,
    rejectionCode: data.code,
    incomplete: false,
    incompleteReasons: [],
  };
}

function projectFailedShellResult(
  args: ShellArguments,
  toolCallId: string | undefined
): ShellCommandExecutionPresentationData {
  return {
    kind: 'command_execution',
    source: 'shell',
    state: 'failed',
    toolCallId,
    command: args.command,
    ...(args.cwd ? { cwd: args.cwd } : {}),
    interactive: args.interactive,
    observation: '',
    incomplete: false,
    incompleteReasons: [],
  };
}

function projectProcessResult(
  args: ProcessArguments,
  result: ProcessToolStructuredResult
): ProcessCommandExecutionPresentationData {
  const data = result.data;
  if (data.status === 'running') {
    return {
      kind: 'command_execution',
      source: 'process',
      effect: 'observation',
      state: 'running',
      processHandle: args.processHandle,
      action: args.action,
      nextCursor: data.nextCursor,
      observation: data.presentationText,
      display: data.display,
      ...(data.presentation ? { executionFacts: data.presentation } : {}),
      incomplete: isIncomplete(data.display),
      incompleteReasons: readIncompleteReasons(data.display),
    };
  }
  if (data.status === 'completed') {
    return {
      kind: 'command_execution',
      source: 'process',
      effect: 'observation',
      state: 'completed',
      processHandle: args.processHandle,
      action: args.action,
      observation: data.presentationText,
      ...(data.display ? { display: data.display } : {}),
      ...(data.presentation ? { executionFacts: data.presentation } : {}),
      terminal: data.terminal,
      incomplete: isIncomplete(data.display),
      incompleteReasons: readIncompleteReasons(data.display),
    };
  }
  if (data.status === 'accepted') {
    return {
      kind: 'command_execution',
      source: 'process',
      effect: 'control_accepted',
      state: 'running',
      processHandle: args.processHandle,
      action: args.action,
      observation: data.presentationText,
      ...(data.audit_status ? { auditStatus: data.audit_status } : {}),
      incomplete: false,
      incompleteReasons: [],
    };
  }
  return {
    kind: 'command_execution',
    source: 'process',
    effect: 'rejected',
    state: 'rejected',
    processHandle: args.processHandle,
    action: args.action,
    observation: data.presentationText,
    rejectionCode: data.code,
    ...(data.audit_status ? { auditStatus: data.audit_status } : {}),
    incomplete: false,
    incompleteReasons: [],
  };
}

function projectFailedProcessResult(
  args: ProcessArguments
): ProcessCommandExecutionPresentationData {
  return {
    kind: 'command_execution',
    source: 'process',
    effect: 'failed',
    state: 'failed',
    processHandle: args.processHandle,
    action: args.action,
    observation: '',
    incomplete: false,
    incompleteReasons: [],
  };
}

function title(data: CommandExecutionPresentationData) {
  const state = data.state;
  const fallback =
    state === 'running' || state === 'starting'
      ? 'Running command'
      : state === 'completed'
        ? 'Command completed'
        : state === 'rejected'
          ? 'Command rejected'
          : 'Command failed';
  if (data.source !== 'shell' || data.kind === 'command_execution_lifecycle') {
    const key =
      state === 'running' || state === 'starting'
        ? 'conversation.tool.command.running'
        : state === 'completed'
          ? 'conversation.tool.command.completed'
          : state === 'rejected'
            ? 'conversation.tool.command.rejected'
            : 'conversation.tool.command.failed';
    return { text: { key, fallback } } as const;
  }
  const key =
    state === 'running' || state === 'starting'
      ? 'conversation.tool.command.shellRunning'
      : state === 'completed'
        ? 'conversation.tool.command.shellCompleted'
        : state === 'rejected'
          ? 'conversation.tool.command.shellRejected'
          : 'conversation.tool.command.shellFailed';
  return {
    text: {
      key,
      fallback: `${fallback}: ${data.command}`,
      params: { command: data.command },
    },
  } as const;
}

export function projectCommandExecutionPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<CommandExecutionPresentationData> {
  if (input.sourceToolName === 'shell') {
    if (input.status !== 'success') {
      const args = readShellLifecycleArguments(input.args);
      const data = !args
        ? projectLifecycle('shell', input.status, input.toolCallId)
        : input.status === 'loading'
          ? {
              kind: 'command_execution' as const,
              source: 'shell' as const,
              state: 'starting' as const,
              toolCallId: input.toolCallId,
              command: args.command,
              ...(args.cwd ? { cwd: args.cwd } : {}),
              interactive: args.interactive,
              observation: '',
              incomplete: false,
              incompleteReasons: [],
            }
          : projectFailedShellResult(args, input.toolCallId);
      return { data, title: title(data) };
    }
    const args = readShellArguments(input.args);
    const data = projectShellResult(
      args,
      ShellToolStructuredResultSchema.parse(input.result),
      input.toolCallId
    );
    return { data, title: title(data) };
  }
  if (input.sourceToolName !== 'process') {
    throw new Error(`命令展示不能处理工具: ${input.sourceToolName}`);
  }
  if (input.status !== 'success') {
    const args = readProcessLifecycleArguments(input.args);
    const data = !args
      ? projectLifecycle('process', input.status, input.toolCallId)
      : input.status === 'loading'
        ? {
            kind: 'command_execution' as const,
            source: 'process' as const,
            effect: 'pending' as const,
            state: 'running' as const,
            processHandle: args.processHandle,
            action: args.action,
            observation: '',
            incomplete: false,
            incompleteReasons: [],
          }
        : projectFailedProcessResult(args);
    return { data, title: title(data) };
  }
  const args = readProcessArguments(input.args);
  const data = projectProcessResult(args, ProcessToolStructuredResultSchema.parse(input.result));
  return { data, title: title(data) };
}
