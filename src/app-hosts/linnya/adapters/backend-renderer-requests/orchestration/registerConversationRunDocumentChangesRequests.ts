import {
  CONVERSATION_RUN_DOCUMENT_CHANGES_CHANNEL,
  ConversationRunDocumentChangesRequestSchema,
} from '@app/schemas';
import { readConversationRunDocumentChanges } from 'src/app-hosts/linnya/application/run-document-changes';
import type { BackendRuntimeOwner } from '../../../backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererRequestRegistryPort } from '../definitions/backendRendererRequest';

export function registerConversationRunDocumentChangesRequests(
  runtimeOwner: BackendRuntimeOwner,
  registry: BackendRendererRequestRegistryPort,
): void {
  const databaseService = runtimeOwner.getServices().databaseService;
  if (!databaseService) throw new Error('Run document changes require database service');
  registry.handle(CONVERSATION_RUN_DOCUMENT_CHANGES_CHANNEL, request => readConversationRunDocumentChanges(
    databaseService.getDb(),
    ConversationRunDocumentChangesRequestSchema.parse(request),
  ));
}
