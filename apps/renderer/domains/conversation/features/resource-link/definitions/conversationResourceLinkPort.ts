import type { Component } from 'vue';
import type {
  ConversationFileLinkResolution,
  ConversationFileLinkResolveRequest,
} from '@app/schemas';

export type ConversationResourceLinkTarget =
  | Exclude<ConversationFileLinkResolution, { state: 'ready'; kind: 'workspace' }>
  | (Extract<ConversationFileLinkResolution, { state: 'ready'; kind: 'workspace' }> & {
      readonly activeDocumentType: string;
      readonly iconComponent: Component;
      readonly iconClass: string;
    });

export interface ConversationResourceLinkPort {
  resolve(request: ConversationFileLinkResolveRequest): Promise<ConversationResourceLinkTarget>;
  open(input: {
    readonly conversationId: string;
    readonly target: Extract<ConversationResourceLinkTarget, { state: 'ready' }>;
  }): Promise<void>;
}
