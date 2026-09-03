import {
  createOperationFailure,
  createUserFacingMessage,
  type OperationFailure,
} from '@app/schemas';
import {
  KnowledgeBaseDefaultDeleteBlockedError,
  KnowledgeBaseIdRequiredError,
  KnowledgeBaseInvalidRequestError,
  KnowledgeBaseNameRequiredError,
  KnowledgeBaseNotFoundError,
  KnowledgeBaseReadAfterUpdateFailedError,
} from '../../../../features/knowledge-base/definitions/knowledgeBaseErrors';

export type KnowledgeBaseOperationFallbackKey =
  | 'knowledgeBase.create.error.createFailed'
  | 'knowledgeBase.service.error.createIpcFailed'
  | 'knowledgeBase.service.error.getAllIpcFailed'
  | 'knowledgeBase.service.error.deleteIpcFailed'
  | 'knowledgeBase.service.error.getDocumentsIpcFailed'
  | 'knowledgeBase.service.error.updateSettingsIpcFailed'
  | 'knowledgeBase.graph.error.progressLoadFailed';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(error: unknown, key: string): OperationFailure {
  const diagnostic = getErrorMessage(error);
  return createOperationFailure(
    diagnostic,
    createUserFacingMessage(key, { diagnostic }),
  );
}

export function createKnowledgeBaseOperationFailure(
  error: unknown,
  fallbackKey: KnowledgeBaseOperationFallbackKey,
): OperationFailure {
  if (error instanceof KnowledgeBaseNameRequiredError) {
    return failure(error, 'knowledgeBase.create.error.nameRequired');
  }

  if (error instanceof KnowledgeBaseIdRequiredError) {
    return failure(error, fallbackKey);
  }

  if (error instanceof KnowledgeBaseInvalidRequestError) {
    return failure(error, fallbackKey);
  }

  if (error instanceof KnowledgeBaseNotFoundError) {
    return failure(error, 'knowledgeBase.common.notFound');
  }

  if (error instanceof KnowledgeBaseDefaultDeleteBlockedError) {
    return failure(error, 'knowledgeBase.settings.error.defaultDeleteBlocked');
  }

  if (error instanceof KnowledgeBaseReadAfterUpdateFailedError) {
    return failure(error, 'knowledgeBase.settings.error.saveFailed');
  }

  return failure(error, fallbackKey);
}
