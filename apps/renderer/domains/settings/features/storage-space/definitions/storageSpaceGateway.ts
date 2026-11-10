import type {
  StorageSpaceErrorCode,
  StorageSpaceOverviewResponse,
} from '@app/schemas';

export interface StorageSpaceGateway {
  readOverview(): Promise<StorageSpaceOverviewResponse>;
}

export class StorageSpaceGatewayError extends Error {
  constructor(readonly code: StorageSpaceErrorCode) {
    super(code);
    this.name = 'StorageSpaceGatewayError';
  }
}
