import {
  CommandProcessHandleSchema,
  CommandAgentRunIdSchema,
  CommandControlToolCallIdSchema,
  CommandConversationIdSchema,
  MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS,
  MAX_PROCESS_INTERACTION_INPUT_BYTES,
  MAX_PROCESS_PTY_DIMENSION,
  ProcessToolArgumentsV1Schema,
  parseProcessToolArguments,
  type ProcessToolResultData,
  type ProcessToolRuntimeResult,
} from '@app/schemas/commands';

import {
  BaseTool,
  type StructuredToolResult,
  type ToolContext,
  type ToolParameterSchema,
} from '../../types';
import { parseProcessToolRuntimeResult } from 'src/app-hosts/linnya/adapters/commands/shell-runtime/definitions';
import { formatProcessToolModelObservation } from 'src/domains/commands';
import { processProtocolViolationMessage } from './functions/processProtocolViolationMessage';

type ParsedProcessArguments = ReturnType<typeof parseProcessToolArguments>;
type ProcessProtocolViolation = {
  readonly kind: 'protocol_violation';
  readonly processHandle: ParsedProcessArguments['process_handle'];
  readonly result: ProcessToolRuntimeResult;
};
type ParsedProcessRequest =
  | { readonly kind: 'arguments'; readonly arguments: ParsedProcessArguments }
  | ProcessProtocolViolation;

const PROCESS_ACTION_PARAMETER: ToolParameterSchema['properties'][string] = {
  type: 'object',
  description: 'Object with a type discriminator and only that action’s fields; never a string.',
  oneOf: [
    {
      type: 'object',
      description: 'Read available output immediately.',
      properties: {
        type: { type: 'string', description: 'Poll output.', enum: ['poll'] },
        cursor: {
          type: 'integer',
          description: 'Output cursor returned by the previous shell or process result.',
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
      required: ['type', 'cursor'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'Wait for new output or process completion.',
      properties: {
        type: { type: 'string', description: 'Wait for output.', enum: ['wait'] },
        cursor: {
          type: 'integer',
          description: 'Output cursor returned by the previous shell or process result.',
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        wait_timeout_ms: {
          type: 'integer',
          description: 'Maximum time for this wait action only.',
          minimum: 1,
          maximum: MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS,
        },
      },
      required: ['type', 'cursor', 'wait_timeout_ms'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'Stop the complete process tree.',
      properties: {
        type: { type: 'string', description: 'Cancel the process.', enum: ['cancel'] },
      },
      required: ['type'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'Write non-empty input to an interactive terminal.',
      properties: {
        type: { type: 'string', description: 'Write terminal input.', enum: ['write'] },
        input: {
          type: 'string',
          minLength: 1,
          description: `Input to write; at most ${MAX_PROCESS_INTERACTION_INPUT_BYTES} UTF-8 bytes.`,
        },
      },
      required: ['type', 'input'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'Write input and send the platform Enter key.',
      properties: {
        type: { type: 'string', description: 'Submit terminal input.', enum: ['submit'] },
        input: {
          type: 'string',
          description: `Input to submit; may be empty; at most ${MAX_PROCESS_INTERACTION_INPUT_BYTES} UTF-8 bytes.`,
        },
      },
      required: ['type', 'input'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'Close interactive terminal input.',
      properties: {
        type: { type: 'string', description: 'Close terminal input.', enum: ['eof'] },
      },
      required: ['type'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'Resize an interactive terminal.',
      properties: {
        type: { type: 'string', description: 'Resize the terminal.', enum: ['resize'] },
        columns: {
          type: 'integer',
          description: 'Terminal columns.',
          minimum: 1,
          maximum: MAX_PROCESS_PTY_DIMENSION,
        },
        rows: {
          type: 'integer',
          description: 'Terminal rows.',
          minimum: 1,
          maximum: MAX_PROCESS_PTY_DIMENSION,
        },
      },
      required: ['type', 'columns', 'rows'],
      additionalProperties: false,
    },
  ],
};

function projectProcessToolResultData(result: ProcessToolRuntimeResult): ProcessToolResultData {
  if (result.status === 'running') {
    return {
      status: 'running',
      presentationText: result.observation,
      nextCursor: result.nextCursor,
      display: result.display,
      presentation: result.presentation,
    };
  }
  if (result.status === 'completed') {
    return {
      status: 'completed',
      presentationText: result.observation,
      terminal: result.terminal,
      command_output_store: result.command_output_store,
      presentation: result.presentation,
      ...(result.display ? { display: result.display } : {}),
    };
  }
  if (result.status === 'accepted') {
    return {
      status: 'accepted',
      presentationText: result.observation,
      ...(result.audit_status ? { audit_status: result.audit_status } : {}),
    };
  }
  return {
    status: 'rejected',
    presentationText: result.observation,
    code: result.code,
    ...(result.audit_status ? { audit_status: result.audit_status } : {}),
  };
}

function protocolViolationResult(
  processHandle: ParsedProcessArguments['process_handle'],
  message: string,
): ProcessProtocolViolation {
  return {
    kind: 'protocol_violation',
    processHandle,
    result: {
      status: 'rejected',
      code: 'process_protocol_violation',
      observation: message,
    },
  };
}

function parseArgumentsOrProtocolViolation(
  args: Record<string, unknown>,
): ParsedProcessRequest {
  const parsed = ProcessToolArgumentsV1Schema.safeParse(args);
  if (parsed.success) return { kind: 'arguments', arguments: parsed.data };
  const message = processProtocolViolationMessage(args, parsed.error);

  const processHandle = typeof args.process_handle === 'string' ? args.process_handle : '';
  const parsedHandle = CommandProcessHandleSchema.safeParse(processHandle);
  if (!parsedHandle.success) {
    throw new Error(message);
  }
  const extraFields = Object.keys(args).filter(key => key !== 'process_handle' && key !== 'action');
  if (extraFields.length > 0) {
    throw new Error(message);
  }
  return protocolViolationResult(
    parsedHandle.data,
    message,
  );
}

export class ProcessTool extends BaseTool {
  readonly name = 'process';

  /** ToolRegistry 用它把 owner admission 失败归类为稳定的协议错误。 */
  readonly argumentValidationErrorCode = 'process_protocol_violation';

  readonly description = `Observe or control a command previously started by the shell tool.

Use the opaque process handle returned by shell. Poll returns immediately; wait waits for output
or completion. Interactive terminal processes also accept write, submit, eof and resize. Cancel
stops the complete process tree. Completed handles are retained temporarily. Handles cannot be
replaced with process IDs or run IDs.

The only top-level fields are process_handle and action. action must be an object: put the action
name in action.type, and put cursor/wait_timeout_ms/input/columns/rows inside that action object.
For poll/wait, copy next_cursor from the latest result for the same process; do not guess it.`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      process_handle: {
        type: 'string',
        minLength: 1,
        description: 'Opaque process handle returned by shell.',
      },
      action: PROCESS_ACTION_PARAMETER,
    },
    required: ['process_handle', 'action'],
    additionalProperties: false,
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    const parsed = ProcessToolArgumentsV1Schema.safeParse(args);
    return parsed.success
      ? { success: true }
      : { success: false, error: processProtocolViolationMessage(args, parsed.error) };
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const runtime = context.shellToolRuntime;
    if (!runtime) {
      throw new Error('process 工具宿主运行时未配置');
    }
    if (!context.commandRunPermission) {
      throw new Error('process 工具缺少当前 run 的权限快照');
    }

    // process 是跨 tool call 的公开入口，必须在这里再次收紧 host 返回值，不能让内部
    // scope、owner 或平台对象因实现疏忽穿透到 Agent。
    const parsedOrViolation = parseArgumentsOrProtocolViolation(args);
    const result = parsedOrViolation.kind === 'protocol_violation'
      ? parsedOrViolation.result
      : parseProcessToolRuntimeResult(await runtime.executeProcess({
          arguments: parsedOrViolation.arguments,
          conversationId: CommandConversationIdSchema.parse(context.conversationId),
          agentRunId: CommandAgentRunIdSchema.parse(context.runId),
          controlToolCallId: CommandControlToolCallIdSchema.parse(context.parentToolCallId),
          commandRunPermission: context.commandRunPermission,
          ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
        }));
    // 与模型出口分开投影，避免 host 新字段未经审阅就进入 renderer 持久结果。
    const data = projectProcessToolResultData(result);
    const structured: StructuredToolResult<typeof data> = {
      data,
      observation: formatProcessToolModelObservation({
        processHandle: parsedOrViolation.kind === 'protocol_violation'
          ? parsedOrViolation.processHandle
          : parsedOrViolation.arguments.process_handle,
        result,
      }),
    };
    return JSON.stringify(structured);
  }
}
