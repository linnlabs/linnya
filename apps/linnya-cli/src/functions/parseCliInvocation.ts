import path from 'node:path';
import { ConversationControlSkillsRequestSchema } from '@app/schemas';
import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  ConversationControlAuditRequestSchema,
  ConversationControlCommandRequestSchema,
  ConversationControlCommandApprovalsRequestSchema,
  ConversationControlListRequestSchema,
  ConversationControlModelsRequestSchema,
  ConversationControlProjectsRequestSchema,
  ConversationControlMessagesRequestSchema,
  ConversationControlRespondRequestSchema,
  ConversationControlResultRequestSchema,
  ConversationControlSendRequestSchema,
  ConversationControlStatusRequestSchema,
  ConversationControlStopRequestSchema,
  ConversationControlToolsCallRequestSchema,
  ConversationControlToolsDescribeRequestSchema,
  ConversationControlToolsListRequestSchema,
  ConversationControlWebToolAccessRequestSchema,
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
  'create',
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
      if (BOOLEAN_OPTIONS.has(name) || (value.length === 0 && name !== 'description')) {
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

function readPort(tokens: ParsedTokens, name: string, fallback: number, allowZero = false): number {
  const value = readString(tokens, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > 65_535) {
    usageError(`Option --${name} must be an integer between ${minimum} and 65535`);
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
    case 'skills': {
      const [action, name, filePath = 'SKILL.md'] = tokens.positionals;
      assertAllowedOptions(tokens, action === 'write' ? ['from', 'create']
        : action === 'install' || action === 'update' ? ['from'] : action === 'edit' ? ['old', 'new'] : []);
      if (!action) usageError('skills requires list, read, validate, install, update, remove, write or edit');
      const from = readString(tokens, 'from');
      if (action === 'write') {
        if (!name || !from || tokens.positionals.length > 3) usageError('skills write NAME [PATH] --from FILE [--create]');
        return { kind: 'skill-write', name, path: filePath, file: path.resolve(from),
          create: readBoolean(tokens, 'create'), pretty };
      }
      let request: unknown;
      if (action === 'list' && tokens.positionals.length === 1) request = { action };
      else if (action === 'validate' && name && tokens.positionals.length === 2) {
        request = { action, source_directory: path.resolve(name) };
      } else if ((action === 'install' || action === 'update') && name && from && tokens.positionals.length === 2) {
        request = { action, name, source_directory: path.resolve(from) };
      } else if ((action === 'remove' || action === 'uninstall') && name && tokens.positionals.length === 2) {
        request = { action: 'remove', name };
      } else if ((action === 'read' || action === 'delete_file') && name && tokens.positionals.length <= 3) {
        request = { action, name, path: filePath };
      } else if (action === 'edit' && name && tokens.positionals.length <= 3) {
        request = { action, name, path: filePath, old_string: readString(tokens, 'old'),
          new_string: tokens.options.get('new') };
      } else usageError('Invalid skills command. Use --help for the supported forms.');
      return { kind: 'command', pretty, request: ConversationControlSkillsRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION, command: 'skills', request,
      }) };
    }
    case 'runtime': {
      assertAllowedOptions(tokens, ['workspace', 'api-port', 'qdrant-port']);
      if (tokens.positionals.length !== 1 || tokens.positionals[0] !== 'start') {
        usageError('runtime requires exactly: runtime start');
      }
      return {
        kind: 'runtime-start',
        workspaceDirectory: readString(tokens, 'workspace'),
        apiPort: readPort(tokens, 'api-port', 0, true),
        qdrantPort: readPort(tokens, 'qdrant-port', 6333),
        pretty,
      };
    }
    case 'doctor': {
      assertAllowedOptions(tokens, []);
      if (tokens.positionals.length > 0) usageError('doctor does not accept positional arguments');
      return { kind: 'doctor', pretty };
    }
    case 'send': {
      assertAllowedOptions(tokens, [
        'conversation', 'project', 'agent', 'model', 'image-model', 'reasoning', 'research-scope-json',
      ]);
      const message = tokens.positionals.join(' ').trim();
      const projectId = readString(tokens, 'project');
      // CLI 不跟随前端当前项目；要求显式身份，避免创建用户无法定位的无项目研究会话。
      if (!projectId) {
        usageError('send requires --project <id>; run linnya projects to select a project. Existing conversations must use their bound project.');
      }
      const request = ConversationControlSendRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'send',
        message,
        conversation_id: readString(tokens, 'conversation'),
        project_id: projectId,
        selected_agent_id: readString(tokens, 'agent'),
        model_id: readString(tokens, 'model'),
        image_generation_model_id: readString(tokens, 'image-model'),
        reasoning_effort: readString(tokens, 'reasoning'),
        research_scope: tokens.options.has('research-scope-json')
          ? parseJsonOption(tokens, 'research-scope-json') : undefined,
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
    case 'projects': {
      const [action = 'list', identity] = tokens.positionals;
      assertAllowedOptions(tokens, action === 'create' ? ['description']
        : action === 'update' ? ['name', 'description'] : []);
      const base = { schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION, command: 'projects', action };
      // 描述允许显式空字符串以清空；名称交由共享合同 trim 后验证，不能把空名称当作未提供。
      const description = tokens.options.get('description');
      const name = tokens.options.get('name');
      let input: unknown;
      if (action === 'list' && tokens.positionals.length <= 1) input = base;
      else if (action === 'get' && tokens.positionals.length === 2) {
        input = { ...base, project_id: identity?.trim() };
      } else if (action === 'create' && tokens.positionals.length === 2) {
        input = { ...base, input: { name: identity, description } };
      } else if (action === 'update' && tokens.positionals.length === 2) {
        input = { ...base, project_id: identity?.trim(), updates: { name, description } };
      } else usageError('projects requires list, get ID, create NAME [--description TEXT], or update ID [--name NAME] [--description TEXT]');
      const request = ConversationControlProjectsRequestSchema.parse(input);
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
    case 'resume': {
      assertAllowedOptions(tokens, ['run', 'timeout']);
      const runId = readString(tokens, 'run');
      if (!runId) usageError('resume requires --run <id> to identify the exact paused run');
      return {
        kind: 'resume',
        conversationId: requireConversationId(tokens, 'resume'),
        runId,
        timeoutMs: readPositiveInteger(tokens, 'timeout', 60_000),
        pretty,
      };
    }
    case 'approvals':
    case 'approval-reply': {
      assertAllowedOptions(tokens, command === 'approvals' ? ['run'] : ['run', 'request', 'choice']);
      const runId = readString(tokens, 'run');
      if (!runId) usageError(`${command} requires --run <id> to identify the exact approval scope`);
      const identity = {
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'command_approvals',
        conversation_id: requireConversationId(tokens, command),
        run_id: runId,
      } as const;
      const request = ConversationControlCommandApprovalsRequestSchema.parse(
        command === 'approvals'
          ? { ...identity, action: 'list' }
          : {
              ...identity,
              action: 'reply',
              approval_request_id: readString(tokens, 'request'),
              choice: readString(tokens, 'choice'),
            }
      );
      return { kind: 'command', request, pretty };
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
      assertAllowedOptions(tokens, ['run', 'reason', 'timeout']);
      const request = ConversationControlStopRequestSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        command: 'stop',
        conversation_id: requireConversationId(tokens, 'stop'),
        expected_run_id: readString(tokens, 'run'),
        reason: readString(tokens, 'reason') ?? 'terminated by linnya CLI',
      });
      return { kind: 'stop', request, pretty,
        timeoutMs: readPositiveInteger(tokens, 'timeout', 60_000) };
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
      if (action === 'web') {
        assertAllowedOptions(tokens, []);
        const mode = tokens.positionals[1];
        if (tokens.positionals.length !== 2 || !['on', 'off', 'status'].includes(mode ?? '')) {
          usageError('tools web requires exactly one of: on, off, status');
        }
        const request = ConversationControlWebToolAccessRequestSchema.parse({
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          command: 'tools',
          action: 'web_access',
          ...(mode === 'status' ? {} : { enabled: mode === 'on' }),
        });
        return { kind: 'command', request, pretty };
      }
      if (action === 'list') {
        assertAllowedOptions(tokens, []);
        if (tokens.positionals.length !== 1) usageError('tools list does not accept arguments');
        const request = ConversationControlToolsListRequestSchema.parse({
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          command: 'tools',
          action: 'list',
        });
        return { kind: 'command', request, pretty };
      }
      if (action === 'describe') {
        assertAllowedOptions(tokens, []);
        if (tokens.positionals.length !== 2) {
          usageError('tools describe requires exactly one tool name');
        }
        const request = ConversationControlToolsDescribeRequestSchema.parse({
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          command: 'tools',
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
        const request = ConversationControlToolsCallRequestSchema.parse({
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          command: 'tools',
          action: 'call',
          tool_name: tokens.positionals[1],
          args: readString(tokens, 'args-json') === undefined
            ? {}
            : parseJsonOption(tokens, 'args-json'),
          conversation_id: readString(tokens, 'conversation'),
          project_id: readString(tokens, 'project'),
        });
        return {
          kind: 'tool-call',
          argsFile: readString(tokens, 'args-file'),
          omitArgs: tokens.options.has('omit-args'),
          request,
          intervalMs: readPositiveInteger(tokens, 'interval', 250),
          timeoutMs: readPositiveInteger(tokens, 'timeout', 60_000),
          pretty,
        };
      }
      usageError('tools requires one of: list, describe, call, web');
    }
    default:
      usageError(`Unknown command: ${command}`);
  }
}

export function parseCliInvocation(argv: readonly string[]): LinnyaCliInvocation {
  // pnpm run script -- ... 与直接调用共享同一入口；仅移除命令前的分隔符。
  if (argv[0] === '--') return parseCliInvocation(argv.slice(1));
  if (argv.length === 0) return { kind: 'help' };
  if (argv[0] === '--help' || argv[0] === '-h') return { kind: 'help' };
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
    || invocation.kind === 'stop'
    || invocation.kind === 'tool-call'
  ) {
    ConversationControlCommandRequestSchema.parse(invocation.request);
  }
  return invocation;
}
