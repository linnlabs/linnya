import type {
  StorageSpaceErrorCode,
  StorageSpaceOverviewResponse,
} from '@app/schemas';

export interface StorageSpaceGateway {
  readOverview(): Promise<StorageSpaceOverviewResponse>;
  clearConversationWorkDirectory(conversationId: string): Promise<void>;
}

export class StorageSpaceGatewayError extends Error {
  constructor(readonly code: StorageSpaceErrorCode) {
    super(code);
    this.name = 'StorageSpaceGatewayError';
  }
}
