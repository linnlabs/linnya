import type {
  ConversationFileLinkResolution,
  ConversationFileLinkResolveRequest,
  ConversationFileLinkRevealRequest,
} from '@app/schemas';

export interface ConversationFileLinkRuntimePort {
  resolve(request: ConversationFileLinkResolveRequest): Promise<ConversationFileLinkResolution>;
  reveal(
    request: ConversationFileLinkRevealRequest,
    revealFile: (absolutePath: string) => Promise<void> | void,
  ): Promise<void>;
}
