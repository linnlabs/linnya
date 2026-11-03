import type {
  ConversationControlCapability,
  ConversationControlCommandRequest,
  ConversationControlCommandResponse,
  ConversationControlConnectionDescriptor,
  ConversationControlErrorCode,
  ConversationControlHandshakeResponse,
  ConversationControlStatusRequest,
  ConversationControlStopRequest,
  ConversationControlToolsRequest,
} from '@app/schemas';
import packageManifest from '../../package.json';

export const LINNYA_CLI_VERSION = packageManifest.version;

declare const __LINNYA_CLI_BUILD_ID__: string | undefined;
export const LINNYA_CLI_BUILD_ID = typeof __LINNYA_CLI_BUILD_ID__ === 'undefined'
  ? 'source' : __LINNYA_CLI_BUILD_ID__;

export const LINNYA_CLI_EXIT = {
  success: 0,
  usage: 2,
  connection: 3,
  protocol: 4,
  unauthorized: 5,
  conflict: 6,
  unavailable: 7,
  internal: 8,
} as const;

export type ConversationControlSuccessResponse = Extract<
  ConversationControlCommandResponse,
  { readonly ok: true }
>;

export interface LinnyaCliIo {
  readonly write: (text: string) => void;
  readonly writeError: (text: string) => void;
}

export interface LinnyaCliRuntimeIdentity {
  readonly pid: number;
  readonly applicationVersion: string;
  readonly apiPort: number;
  readonly databaseReady: true;
}

export interface LinnyaCliRuntimeLauncherPort {
  run(input: {
    /** 整套数据工作区的物理目录。Project 管理只操作已连接 Backend 内的项目记录。 */
    readonly workspaceDirectory?: string;
    readonly apiPort: number;
    readonly qdrantPort: number;
    readonly onReady: (identity: LinnyaCliRuntimeIdentity) => void;
  }): Promise<void>;
}

export interface ConversationControlClient {
  readonly descriptor: ConversationControlConnectionDescriptor;
  readonly handshake: ConversationControlHandshakeResponse;
  execute(
    request: ConversationControlCommandRequest,
    options?: { readonly timeoutMs: number },
  ): Promise<ConversationControlSuccessResponse>;
}

export interface ConversationControlConnectionPort {
  connect(): Promise<ConversationControlClient>;
}

export type LinnyaCliInvocation =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'skill-write'; readonly name: string; readonly path: string;
      readonly file: string; readonly create: boolean; readonly pretty: boolean }
  | { readonly kind: 'doctor'; readonly pretty: boolean }
  | {
      readonly kind: 'runtime-start';
      readonly workspaceDirectory?: string;
      readonly apiPort: number;
      readonly qdrantPort: number;
      readonly pretty: boolean;
    }
  | {
      readonly kind: 'stop';
      readonly request: ConversationControlStopRequest;
      readonly timeoutMs: number;
      readonly pretty: boolean;
    }
  | {
      readonly kind: 'resume';
      readonly conversationId: string;
      readonly runId: string;
      readonly timeoutMs: number;
      readonly pretty: boolean;
    }
  | {
      readonly kind: 'command';
      readonly request: Exclude<
        ConversationControlCommandRequest,
        | ConversationControlStatusRequest
        | ConversationControlStopRequest
        | Extract<ConversationControlCommandRequest, { command: 'resume' }>
        | Extract<ConversationControlToolsRequest, { action: 'call' }>
      >;
      readonly pretty: boolean;
    }
  | {
      readonly kind: 'status';
      readonly request: ConversationControlStatusRequest;
      readonly watch: boolean;
      readonly intervalMs: number;
      readonly timeoutMs: number;
      readonly pretty: boolean;
    }
  | {
      readonly kind: 'tool-call';
      readonly argsFile?: string;
      readonly omitArgs: boolean;
      readonly request: Extract<ConversationControlToolsRequest, { action: 'call' }>;
      readonly intervalMs: number;
      readonly timeoutMs: number;
      readonly pretty: boolean;
    };

export class LinnyaCliError extends Error {
  constructor(
    readonly code: ConversationControlErrorCode,
    message: string,
    readonly retryable = false,
    readonly command?: ConversationControlCommandRequest['command'],
  ) {
    super(message);
    this.name = 'LinnyaCliError';
  }
}

/**
 * `audit` 只在 Host 的 Agent Run Audit 不是 off 时才出现在握手里；开发进程默认 off，发行包永远 off。
 * 控制协议要求 CLI 与 App 版本严格一致，所以握手缺少 `audit` 唯一的原因就是审计未启用，
 * 不是 App 版本太旧。这里给出可执行的修复路径；错误码仍是 capability_unavailable，调用方靠它识别。
 */
const AUDIT_UNAVAILABLE_MESSAGE =
  'Agent Run Audit is not enabled in the running Linnya App, so audit is unavailable. '
  + 'It is a development diagnostic: off by default and always off in packaged Desktop builds. '
  + 'Start a development App (or "linnya runtime start") with LINNYA_AUDIT_LEVEL=behavior|response|stream '
  + 'and connect this CLI to it (LINNYA_CLI_CONNECTION_FILE selects the App). '
  + '"linnya doctor" shows which capabilities the connected App declares.';

export function describeUnavailableCapability(capability: ConversationControlCapability): string {
  if (capability === 'audit') return AUDIT_UNAVAILABLE_MESSAGE;
  return `The running Linnya App does not provide the ${capability} capability`;
}

export function requireCapability(
  capabilities: readonly string[],
  command: ConversationControlCommandRequest['command'],
): void {
  if (capabilities.includes(command)) return;
  throw new LinnyaCliError(
    'capability_unavailable',
    describeUnavailableCapability(command),
    false,
    command,
  );
}
