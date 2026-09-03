import {
  CONVERSATION_FILE_LINK_RESOLVE_CHANNEL,
  CONVERSATION_FILE_LINK_REVEAL_CHANNEL,
  ConversationFileLinkResolveRequestSchema,
  ConversationFileLinkRevealRequestSchema,
  type ConversationFileLinkResolution,
  type OperationResult,
} from '@app/schemas';
import { getConversationFileLinkRuntime } from '../../../../app-hosts/linnya/application/file-link';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../app-hosts/linnya/adapters/backend-renderer-requests';
import type { DesktopFileRevealPort } from '../../../../app-hosts/linnya/desktop-capabilities';

function failure(error: unknown): OperationResult<never> {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/** Renderer 只提交 canonical locator 与所属 conversation，不接触宿主绝对路径。 */
export function registerConversationFileLinkHandlers(input: {
  readonly ipc: BackendRendererIpcStyleRegistrarPort;
  readonly fileReveal: DesktopFileRevealPort;
}): void {
  input.ipc.handle(
    CONVERSATION_FILE_LINK_RESOLVE_CHANNEL,
    async (_event, rawRequest: unknown): Promise<OperationResult<ConversationFileLinkResolution>> => {
      try {
        const request = ConversationFileLinkResolveRequestSchema.parse(rawRequest);
        const data = await getConversationFileLinkRuntime().resolve(request);
        return { success: true, data };
      } catch (error: unknown) {
        return failure(error);
      }
    },
  );

  input.ipc.handle(
    CONVERSATION_FILE_LINK_REVEAL_CHANNEL,
    async (_event, rawRequest: unknown): Promise<OperationResult<void>> => {
      try {
        const request = ConversationFileLinkRevealRequestSchema.parse(rawRequest);
        await getConversationFileLinkRuntime().reveal(
          request,
          absolutePath => input.fileReveal.revealInFileManager(absolutePath),
        );
        return { success: true, data: undefined };
      } catch (error: unknown) {
        return failure(error);
      }
    },
  );
}
