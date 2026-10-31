import type { CommandAuthorizationRuntimeContext, CommandRunPermissionContext } from 'src/domains/commands';

export interface InternalStoragePathPolicy {
  isProtectedPath(absolutePath: string, conversationRoot: string): Promise<boolean>;
  commandRequestsAccess(input: {
    readonly command: string;
    readonly cwd: string;
    readonly conversationRoot: string;
    readonly context: CommandAuthorizationRuntimeContext;
  }): Promise<boolean>;
}

export interface InternalStorageFileAccessPort {
  authorizeRead(input: {
    readonly absolutePath: string;
    readonly conversationId: string;
    readonly agentRunId: string;
    readonly toolCallId: string;
    readonly permission: CommandRunPermissionContext;
    readonly abortSignal?: AbortSignal;
  }): Promise<void>;
}
