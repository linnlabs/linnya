export interface ToolResultAssetClaimSelection {
  readonly selectionId: string;
  readonly assetId: string;
}

export interface IssuedToolResultAssetClaim {
  readonly selectionId: string;
  readonly uri: string;
}

export interface ToolResultAssetClaimRegistryPort {
  issueClaims(input: {
    readonly conversationId: string;
    readonly toolCallId: string;
    readonly selections: readonly ToolResultAssetClaimSelection[];
  }): readonly IssuedToolResultAssetClaim[];

  consumeClaims(input: {
    readonly conversationId: string;
    readonly toolCallId: string;
    readonly selections: readonly {
      readonly selectionId: string;
      readonly uri: string;
    }[];
  }): readonly ToolResultAssetClaimSelection[];

  releaseClaims(input: {
    readonly conversationId: string;
    readonly toolCallId: string;
  }): void;
}

export type ToolResultAssetClaimFailure =
  | 'invalid_request'
  | 'claim_id_conflict'
  | 'claim_uri_invalid'
  | 'claim_not_found'
  | 'claim_expired'
  | 'claim_scope_mismatch'
  | 'claim_selection_mismatch';

export class ToolResultAssetClaimError extends Error {
  readonly name = 'ToolResultAssetClaimError';

  constructor(
    readonly failure: ToolResultAssetClaimFailure,
    readonly selectionId?: string,
  ) {
    super(`Tool result asset claim failed: ${failure}`);
  }
}
