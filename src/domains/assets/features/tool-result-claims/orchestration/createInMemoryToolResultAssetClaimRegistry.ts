import { randomUUID } from 'node:crypto';
import type {
  ToolResultAssetClaimRegistryPort,
  ToolResultAssetClaimSelection,
} from '../definitions/toolResultAssetClaim';
import { ToolResultAssetClaimError } from '../definitions/toolResultAssetClaim';
import {
  createToolResultAssetClaimUri,
  parseToolResultAssetClaimUri,
} from '../functions/toolResultAssetClaimUri';

interface StoredClaim extends ToolResultAssetClaimSelection {
  readonly claimId: string;
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly expiresAt: number;
}

function requireIdentity(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new ToolResultAssetClaimError('invalid_request');
  }
  return normalized;
}

export function createInMemoryToolResultAssetClaimRegistry(params?: {
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly createClaimId?: () => string;
}): ToolResultAssetClaimRegistryPort {
  const ttlMs = params?.ttlMs ?? 5 * 60 * 1_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new ToolResultAssetClaimError('invalid_request');
  }
  const now = params?.now ?? Date.now;
  const createClaimId = params?.createClaimId ?? randomUUID;
  const claims = new Map<string, StoredClaim>();

  return {
    issueClaims(input) {
      const conversationId = requireIdentity(input.conversationId);
      const toolCallId = requireIdentity(input.toolCallId);
      if (input.selections.length === 0) {
        throw new ToolResultAssetClaimError('invalid_request');
      }
      const selectionIds = new Set<string>();
      const issuedClaimIds = new Set<string>();
      const staged: StoredClaim[] = input.selections.map((selection) => {
        const selectionId = requireIdentity(selection.selectionId);
        const assetId = requireIdentity(selection.assetId);
        if (selectionIds.has(selectionId)) {
          throw new ToolResultAssetClaimError('invalid_request', selectionId);
        }
        selectionIds.add(selectionId);
        const claimId = createClaimId();
        try {
          createToolResultAssetClaimUri(claimId);
        } catch {
          throw new ToolResultAssetClaimError('invalid_request', selectionId);
        }
        if (claims.has(claimId) || issuedClaimIds.has(claimId)) {
          throw new ToolResultAssetClaimError('claim_id_conflict', selectionId);
        }
        issuedClaimIds.add(claimId);
        return {
          claimId,
          conversationId,
          toolCallId,
          selectionId,
          assetId,
          expiresAt: now() + ttlMs,
        };
      });
      for (const claim of staged) {
        claims.set(claim.claimId, claim);
      }
      return Object.freeze(staged.map(claim => Object.freeze({
        selectionId: claim.selectionId,
        uri: createToolResultAssetClaimUri(claim.claimId),
      })));
    },

    consumeClaims(input) {
      const conversationId = requireIdentity(input.conversationId);
      const toolCallId = requireIdentity(input.toolCallId);
      if (input.selections.length === 0) {
        throw new ToolResultAssetClaimError('invalid_request');
      }
      const claimIds = new Set<string>();
      const resolved = input.selections.map((selection) => {
        const selectionId = requireIdentity(selection.selectionId);
        const claimId = parseToolResultAssetClaimUri(selection.uri);
        if (!claimId || claimIds.has(claimId)) {
          throw new ToolResultAssetClaimError('claim_uri_invalid', selectionId);
        }
        claimIds.add(claimId);
        const claim = claims.get(claimId);
        if (!claim) {
          throw new ToolResultAssetClaimError('claim_not_found', selectionId);
        }
        if (claim.expiresAt <= now()) {
          claims.delete(claimId);
          throw new ToolResultAssetClaimError('claim_expired', selectionId);
        }
        if (claim.conversationId !== conversationId || claim.toolCallId !== toolCallId) {
          throw new ToolResultAssetClaimError('claim_scope_mismatch', selectionId);
        }
        if (claim.selectionId !== selectionId) {
          throw new ToolResultAssetClaimError('claim_selection_mismatch', selectionId);
        }
        return claim;
      });

      for (const claim of resolved) {
        claims.delete(claim.claimId);
      }
      return Object.freeze(resolved.map(claim => Object.freeze({
        selectionId: claim.selectionId,
        assetId: claim.assetId,
      })));
    },

    releaseClaims(input) {
      const conversationId = requireIdentity(input.conversationId);
      const toolCallId = requireIdentity(input.toolCallId);
      for (const [claimId, claim] of claims) {
        if (claim.conversationId === conversationId && claim.toolCallId === toolCallId) {
          claims.delete(claimId);
        }
      }
    },
  };
}
