import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  ConversationControlAuditRequestSchema,
  ConversationControlCommandRequestSchema,
  ConversationControlListRequestSchema,
  ConversationControlModelsRequestSchema,
  ConversationControlMessagesRequestSchema,
  ConversationControlRespondRequestSchema,
  ConversationControlResultRequestSchema,
  ConversationControlSendRequestSchema,
  ConversationControlStatusRequestSchema,
  ConversationControlStopRequestSchema,
  ConversationControlWorkspaceToolsRequestSchema,
  ConversationControlWorkspaceToolsCallRequestSchema,
  ConversationControlWorkspaceToolsDescribeRequestSchema,
  ConversationControlWorkspaceToolsListRequestSchema,
} from '@app/schemas';
import { LinnyaCliError, type LinnyaCliInvocation } from '../definitions/cli';

type OptionValue = string | true;

interface ParsedTokens {
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, OptionValue>;
}

const BOOLEAN_OPTIONS = new Set([
  'help',
  'pretty',
  'watch',
  'approve',
  'skip',
  'omit-args',
]);

function usageError(message: string): never {
  throw new LinnyaCliError('invalid_request', message);
}

function parseTokens(argv: readonly string[]): ParsedTokens {
  const positionals: string[] = [];
  const options = new Map<string, OptionValue>();
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (positionalOnly || !token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      positionalOnly = true;
      continue;
    }
    const normalized = token === '-h' ? '--help' : token;
    if (!normalized.startsWith('--')) usageError(`Unknown option: ${token}`);
    const raw = normalized.slice(2);
    const equals = raw.indexOf('=');
    const name = equals >= 0 ? raw.slice(0, equals) : raw;
    if (!name || options.has(name)) usageError(`Duplicate or empty option: ${token}`);

    if (equals >= 0) {
      const value = raw.slice(equals + 1);
      if (BOOLEAN_OPTIONS.has(name) || value.length === 0) {
        usageError(`Option --${name} does not accept this value`);
      }
      options.set(name, value);
      continue;
    }
    if (BOOLEAN_OPTIONS.has(name)) {
      options.set(name, true);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('-')) {
      usageError(`Option --${name} requires a value`);
    }
    options.set(name, next);
    index += 1;
  }

  return { positionals, options };
}

function assertAllowedOptions(tokens: ParsedTokens, allowed: readonly string[]): void {
  const allowedSet = new Set(['help', 'pretty', ...allowed]);
  for (const name of tokens.options.keys()) {
    if (!allowedSet.has(name)) usageError(`Unknown option for this command: --${name}`);
  }
}

function readString(tokens: ParsedTokens, name: string): string | undefined {
  const value = tokens.options.get(name);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readBoolean(tokens: ParsedTokens, name: string): boolean {
  return tokens.options.get(name) === true;
}

function readPositiveInteger(
  tokens: ParsedTokens,
  name: string,
  fallback: number,
): number {
  const value = readString(tokens, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    usageError(`Option --${name} must be a positive integer`);
  }
  return parsed;
}

function requireConversationId(tokens: ParsedTokens, command: string): string {
  const conversationId = tokens.positionals[0]?.trim();
  if (!conversationId || tokens.positionals.length !== 1) {
    usageError(`${command} requires exactly one conversation id`);
  }
  return conversationId;
}

function parseJsonOption(tokens: ParsedTokens, name: string): unknown {
  const value = readString(tokens, name);
  if (value === undefined) usageError(`Option --${name} requires JSON`);
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    usageError(`Option --${name} must contain valid JSON`);
  }
}

function parseCommand(command: string, tokens: ParsedTokens): LinnyaCliInvocation {
  const pretty = readBoolean(tokens, 'pretty');
  switch (command) {
    case 'send': {
      assertAllowedOptions(tokens, [
        'conversation', 'project', 'agent', 'model', 'image-model', 'reasoning',
      ]);
      const message = tokens.positionals.join(' ').trim();
      const request = ConversationControlSendRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'send',
        message,
        conversation_id: readString(tokens, 'conversation'),
        project_id: readString(tokens, 'project'),
        selected_agent_id: readString(tokens, 'agent'),
        model_id: readString(tokens, 'model'),
        image_generation_model_id: readString(tokens, 'image-model'),
        reasoning_effort: readString(tokens, 'reasoning'),
      });
      return { kind: 'command', request, pretty };
    }
    case 'list': {
      assertAllowedOptions(tokens, ['limit', 'cursor', 'search', 'project']);
      if (tokens.positionals.length > 0) usageError('list does not accept positional arguments');
      const request = ConversationControlListRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'list',
        limit: readPositiveInteger(tokens, 'limit', 30),
        cursor: readString(tokens, 'cursor'),
        search: readString(tokens, 'search'),
        project_id: readString(tokens, 'project'),
      });
      return { kind: 'command', request, pretty };
    }
    case 'models': {
      assertAllowedOptions(tokens, []);
      if (tokens.positionals.length > 0) usageError('models does not accept positional arguments');
      const request = ConversationControlModelsRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'models',
      });
      return { kind: 'command', request, pretty };
    }
    case 'messages': {
      assertAllowedOptions(tokens, ['limit', 'before', 'after']);
      const conversationId = requireConversationId(tokens, 'messages');
      const before = readString(tokens, 'before');
      const after = readString(tokens, 'after');
      if (before && after) usageError('messages accepts only one of --before or --after');
      const requestFields = {
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'messages',
        conversation_id: conversationId,
        limit: readPositiveInteger(tokens, 'limit', 80),
      } as const;
      // tail 合同没有 cursor 字段；不能用 cursor: undefined 伪装“字段缺席”，
      // 否则 strict 判别 schema 会把合法默认命令拒绝掉。
      const request = ConversationControlMessagesRequestSchema.parse(
        before
          ? { ...requestFields, window: 'before', cursor: Number(before) }
          : after
            ? { ...requestFields, window: 'after', cursor: Number(after) }
            : { ...requestFields, window: 'tail' },
      );
      return { kind: 'command', request, pretty };
    }
    case 'status': {
      assertAllowedOptions(tokens, ['run', 'watch', 'interval', 'timeout']);
      const watch = readBoolean(tokens, 'watch');
      if (watch && pretty) {
        usageError('--pretty cannot be combined with status --watch because watch output is JSONL');
      }
      const request = ConversationControlStatusRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'status',
        conversation_id: requireConversationId(tokens, 'status'),
        expected_run_id: readString(tokens, 'run'),
      });
      return {
        kind: 'status',
        request,
        watch,
        intervalMs: readPositiveInteger(tokens, 'interval', 1000),
        timeoutMs: readPositiveInteger(tokens, 'timeout', 60 * 60 * 1000),
        pretty,
      };
    }
    case 'respond': {
      assertAllowedOptions(tokens, [
        'interaction', 'approve', 'skip', 'submit-json', 'modify-json', 'project',
      ]);
      const responseKinds = [
        readBoolean(tokens, 'approve') ? 'approve' : undefined,
        readBoolean(tokens, 'skip') ? 'skip' : undefined,
        readString(tokens, 'submit-json') !== undefined ? 'submit' : undefined,
        readString(tokens, 'modify-json') !== undefined ? 'modify' : undefined,
      ].filter((kind): kind is 'approve' | 'skip' | 'submit' | 'modify' => kind !== undefined);
      if (responseKinds.length !== 1) {
        usageError('respond requires exactly one response option');
      }
      const responseKind = responseKinds[0];
      if (!responseKind) usageError('respond requires a response option');
      const response = responseKind === 'approve' || responseKind === 'skip'
        ? { kind: responseKind }
        : responseKind === 'submit'
          ? { kind: responseKind, value: parseJsonOption(tokens, 'submit-json') }
          : { kind: responseKind, value: parseJsonOption(tokens, 'modify-json') };
      const request = ConversationControlRespondRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'respond',
        conversation_id: requireConversationId(tokens, 'respond'),
        expected_interaction_id: readString(tokens, 'interaction'),
        response,
        project_id: readString(tokens, 'project'),
      });
      return { kind: 'command', request, pretty };
    }
    case 'stop': {
      assertAllowedOptions(tokens, ['run', 'reason']);
      const request = ConversationControlStopRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'stop',
        conversation_id: requireConversationId(tokens, 'stop'),
        expected_run_id: readString(tokens, 'run'),
        reason: readString(tokens, 'reason') ?? 'terminated by linnya CLI',
      });
      return { kind: 'command', request, pretty };
    }
    case 'result': {
      assertAllowedOptions(tokens, ['run']);
      const request = ConversationControlResultRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'result',
        conversation_id: requireConversationId(tokens, 'result'),
        run_id: readString(tokens, 'run'),
      });
      return { kind: 'command', request, pretty };
    }
    case 'audit': {
      assertAllowedOptions(tokens, ['run']);
      const request = ConversationControlAuditRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'audit',
        conversation_id: requireConversationId(tokens, 'audit'),
        run_id: readString(tokens, 'run'),
      });
      return { kind: 'command', request, pretty };
    }
    case 'tools': {
      const action = tokens.positionals[0];
      if (action === 'list') {
        assertAllowedOptions(tokens, []);
        if (tokens.positionals.length !== 1) usageError('tools list does not accept arguments');
        const request = ConversationControlWorkspaceToolsListRequestSchema.parse({
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          command: 'workspace_tools',
          action: 'list',
        });
        return { kind: 'command', request, pretty };
      }
      if (action === 'describe') {
        assertAllowedOptions(tokens, []);
        if (tokens.positionals.length !== 2) {
          usageError('tools describe requires exactly one tool name');
        }
        const request = ConversationControlWorkspaceToolsDescribeRequestSchema.parse({
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          command: 'workspace_tools',
          action: 'describe',
          tool_name: tokens.positionals[1],
        });
        return { kind: 'command', request, pretty };
      }
      if (action === 'call') {
        assertAllowedOptions(tokens, [
          'conversation', 'project', 'args-json', 'args-file', 'omit-args', 'interval', 'timeout',
        ]);
        if (tokens.positionals.length !== 2) {
          usageError('tools call requires exactly one tool name');
        }
        if (readString(tokens, 'args-file') && readString(tokens, 'args-json')) {
          usageError('--args-file and --args-json are mutually exclusive');
        }
        const request = ConversationControlWorkspaceToolsCallRequestSchema.parse({
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          command: 'workspace_tools',
          action: 'call',
          tool_name: tokens.positionals[1],
          args: readString(tokens, 'args-json') === undefined
            ? {}
            : parseJsonOption(tokens, 'args-json'),
          conversation_id: readString(tokens, 'conversation'),
          project_id: readString(tokens, 'project'),
        });
        return {
          kind: 'workspace-tool-call',
          argsFile: readString(tokens, 'args-file'),
          omitArgs: tokens.options.has('omit-args'),
          request,
          intervalMs: readPositiveInteger(tokens, 'interval', 250),
          timeoutMs: readPositiveInteger(tokens, 'timeout', 60_000),
          pretty,
        };
      }
      usageError('tools requires one of: list, describe, call');
    }
    default:
      usageError(`Unknown command: ${command}`);
  }
}

export function parseCliInvocation(argv: readonly string[]): LinnyaCliInvocation {
  if (argv.length === 0) return { kind: 'help' };
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    if (argv.length !== 1) usageError('version does not accept arguments');
    return { kind: 'version' };
  }
  const command = argv[0];
  const tokens = parseTokens(argv.slice(1));
  if (command === 'help' || readBoolean(tokens, 'help')) return { kind: 'help' };
  const invocation = parseCommand(command, tokens);
  // 最终再走顶层 union，防止各命令构造器与 wire 合同发生漂移。
  if (
    invocation.kind === 'command'
    || invocation.kind === 'status'
    || invocation.kind === 'workspace-tool-call'
  ) {
    ConversationControlCommandRequestSchema.parse(invocation.request);
  }
  return invocation;
}
