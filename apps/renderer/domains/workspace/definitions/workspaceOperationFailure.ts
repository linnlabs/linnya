import type { UserFacingMessage } from '@app/schemas';

export interface WorkspaceOperationFailure {
  readonly error: string;
  readonly userMessage?: UserFacingMessage;
}
