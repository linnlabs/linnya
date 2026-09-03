import type Database from 'better-sqlite3';
import type { RuntimeResourceRef } from 'linnkit/contracts';
import type {
  CompleteToolModelInputParams,
  ResolveToolModelInputParams,
  ToolModelInputResolverPort,
} from 'linnkit/runtime-kernel';
import {
  parseToolResultAssetClaimUri,
  ToolResultAssetClaimError,
  type ToolResultAssetClaimRegistryPort,
} from 'src/domains/assets/features/tool-result-claims';
import {
  WorkspaceVerifiedImageError,
  type WorkspaceVerifiedImageLoaderPort,
} from '../../../shared/verified-image';
import {
  WorkspaceToolModelInputError,
  type WorkspaceToolModelInputFailure,
} from '../definitions/workspaceToolModelInput';
import { parseWorkspaceAssetUri } from '../functions/parseWorkspaceAssetUri';

interface ConversationScopeRow {
  readonly project_id: string | null;
}

interface ExistsRow {
  readonly found: 1;
}

function readNonBlankContextField(context: object, field: string): string | undefined {
  const value = Reflect.get(context, field);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function fail(
  failure: WorkspaceToolModelInputFailure,
  selectionId?: string,
  requestIndex?: number,
): never {
  throw new WorkspaceToolModelInputError(failure, selectionId, requestIndex);
}

/**
 * 把工具选择解析为当前会话有权引用的 durable 图片身份。
 *
 * 中文备注：verified loader 会短暂读取 bytes 做完整性复核；本 resolver 只映射账本字段，
 * 不把 bytes、路径或 hash 之外的内部状态留在 graph state。
 */
export function createWorkspaceToolModelInputResolver(params: {
  readonly db: Database.Database;
  readonly verifiedImageLoader: WorkspaceVerifiedImageLoaderPort;
  readonly toolResultClaims: ToolResultAssetClaimRegistryPort;
}): ToolModelInputResolverPort {
  const readConversation = params.db.prepare<[string], ConversationScopeRow>(`
    SELECT project_id
    FROM conversations
    WHERE conversation_id = ?
  `);
  const readProjectAsset = params.db.prepare<[string, string], ExistsRow>(`
    SELECT 1 AS found
    FROM project_asset_links
    WHERE project_id = ? AND asset_id = ?
    LIMIT 1
  `);
  const readConversationAsset = params.db.prepare<[string, string], ExistsRow>(`
    SELECT 1 AS found
    FROM conversation_event_asset_links
    WHERE conversation_id = ? AND asset_id = ?
    LIMIT 1
  `);

  return {
    async completeToolModelInput(input: CompleteToolModelInputParams): Promise<void> {
      const conversationId = readNonBlankContextField(input.context, 'conversationId');
      if (!conversationId) {
        return;
      }
      params.toolResultClaims.releaseClaims({
        conversationId,
        toolCallId: input.toolCallId,
      });
    },

    async resolveToolModelInput(input: ResolveToolModelInputParams): Promise<readonly RuntimeResourceRef[]> {
      const conversationId = readNonBlankContextField(input.context, 'conversationId');
      if (!conversationId) {
        fail('conversation_context_missing');
      }
      const conversation = readConversation.get(conversationId);
      if (!conversation) {
        fail('conversation_not_found');
      }

      const contextProjectId = readNonBlankContextField(input.context, 'workspaceProjectId');
      if (conversation.project_id) {
        if (!contextProjectId) {
          fail('project_context_missing');
        }
        if (contextProjectId !== conversation.project_id) {
          fail('project_context_mismatch');
        }
      } else if (contextProjectId) {
        fail('project_context_mismatch');
      }

      const resolvedAssetIds = new Map<number, string>();
      const claimSelections: Array<{
        readonly requestIndex: number;
        readonly selectionId: string;
        readonly uri: string;
      }> = [];
      input.selections.forEach((selection, requestIndex) => {
        const assetId = parseWorkspaceAssetUri(selection.uri);
        if (assetId) {
          // 项目成员关系与会话事件归属是两种并列授权。项目会话自己的附件
          // 不会自动加入资源库，但在 event 落库后仍必须能由本会话重读。
          const inScope = Boolean(
            (conversation.project_id && readProjectAsset.get(conversation.project_id, assetId))
            || readConversationAsset.get(conversationId, assetId),
          );
          if (!inScope) {
            fail('asset_out_of_scope', selection.id, requestIndex);
          }
          resolvedAssetIds.set(requestIndex, assetId);
          return;
        }
        if (!parseToolResultAssetClaimUri(selection.uri)) {
          fail('asset_uri_invalid', selection.id, requestIndex);
        }
        claimSelections.push({
          requestIndex,
          selectionId: selection.id,
          uri: selection.uri,
        });
      });

      if (claimSelections.length > 0) {
        try {
          const consumed = params.toolResultClaims.consumeClaims({
            conversationId,
            toolCallId: input.toolCallId,
            selections: claimSelections.map(selection => ({
              selectionId: selection.selectionId,
              uri: selection.uri,
            })),
          });
          const requestIndexBySelectionId = new Map(
            claimSelections.map(selection => [selection.selectionId, selection.requestIndex]),
          );
          consumed.forEach((claim) => {
            const requestIndex = requestIndexBySelectionId.get(claim.selectionId);
            if (requestIndex === undefined) {
              fail('artifact_claim_rejected', claim.selectionId);
            }
            resolvedAssetIds.set(requestIndex, claim.assetId);
          });
        } catch (error: unknown) {
          if (!(error instanceof ToolResultAssetClaimError)) {
            throw error;
          }
          const requestIndex = error.selectionId
            ? input.selections.findIndex(selection => selection.id === error.selectionId)
            : undefined;
          fail(
            'artifact_claim_rejected',
            error.selectionId,
            requestIndex === -1 ? undefined : requestIndex,
          );
        }
      }

      const assetIds = input.selections.map((selection, requestIndex) => {
        const assetId = resolvedAssetIds.get(requestIndex);
        if (!assetId) {
          fail('artifact_claim_rejected', selection.id, requestIndex);
        }
        return assetId;
      });

      try {
        const images = await params.verifiedImageLoader.loadImages(
          assetIds.map(assetId => ({ assetId })),
        );
        return Object.freeze(images.map((image, requestIndex) => {
          const selection = input.selections[requestIndex];
          return Object.freeze({
            id: selection.id,
            kind: 'image' as const,
            resourceId: image.assetId,
            mediaType: image.mediaType,
            byteLength: image.byteLength,
            width: image.width,
            height: image.height,
            sha256: image.sha256,
            ...(selection.label ? { label: selection.label } : {}),
          });
        }));
      } catch (error: unknown) {
        if (!(error instanceof WorkspaceVerifiedImageError)) {
          throw error;
        }
        const selection = input.selections[error.requestIndex];
        fail(
          error.code === 'unavailable' ? 'asset_unavailable' : 'asset_integrity_failed',
          selection?.id,
          error.requestIndex,
        );
      }
    },
  };
}
