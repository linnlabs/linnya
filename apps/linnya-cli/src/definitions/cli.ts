import type {
  ConversationControlCapability,
  ConversationControlCommandRequest,
  ConversationControlCommandResponse,
  ConversationControlConnectionDescriptor,
  ConversationControlErrorCode,
  ConversationControlHandshakeResponse,
  ConversationControlStatusRequest,
  ConversationControlWorkspaceToolsRequest,
} from '@app/schemas';
import packageManifest from '../../package.json';

export const LINNYA_CLI_VERSION = packageManifest.version;

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

export interface ConversationControlClient {
  readonly descriptor: ConversationControlConnectionDescriptor;
  readonly handshake: ConversationControlHandshakeResponse;
  execute(request: ConversationControlCommandRequest): Promise<ConversationControlSuccessResponse>;
}

export interface ConversationControlConnectionPort {
  connect(): Promise<ConversationControlClient>;
}

export type LinnyaCliInvocation =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | {
      readonly kind: 'command';
      readonly request: Exclude<
        ConversationControlCommandRequest,
        | ConversationControlStatusRequest
        | Extract<ConversationControlWorkspaceToolsRequest, { action: 'call' }>
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
      readonly kind: 'workspace-tool-call';
      readonly argsFile?: string;
      readonly omitArgs: boolean;
      readonly request: Extract<ConversationControlWorkspaceToolsRequest, { action: 'call' }>;
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

export function requireCapability(
  capabilities: readonly ConversationControlCapability[],
  command: ConversationControlCommandRequest['command'],
): void {
  if (capabilities.includes(command)) return;
  throw new LinnyaCliError(
    'capability_unavailable',
    `The running Linnya App does not provide the ${command} capability`,
    false,
    command,
  );
}
