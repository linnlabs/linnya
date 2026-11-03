import { z } from 'zod';
import { JsonValueSchema, type DocumentAssetByteFact, type DocumentVersionSummary } from '@app/schemas';
import { CanvasElementIdSchema, CanvasElementSchema, type CanvasSnapshot, type CanvasVersionBudgetStatus } from '../../../../shared';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';

export const CanvasVersionInverseSchema = z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('remove'), id: CanvasElementIdSchema }).strict(),
  z.object({ kind: z.literal('put'), id: CanvasElementIdSchema, element: CanvasElementSchema }).strict(),
  z.object({ kind: z.literal('patch'), id: CanvasElementIdSchema, fields: z.record(z.string(), JsonValueSchema), unset: z.array(z.string()) }).strict(),
]));
export type CanvasVersionInverse = z.infer<typeof CanvasVersionInverseSchema>;
export type CanvasVersionElementInverse = CanvasVersionInverse[number];
export interface CanvasVersionRecord {
  readonly versionId: string; readonly sequence: number; readonly createdAt: number;
  readonly previousVersionId: string | null; readonly hash: string;
  readonly inverse: Uint8Array | null; readonly anchor: Uint8Array | null;
  readonly assetIds: readonly string[]; readonly restoredFrom?: DocumentVersionSummary['restoredFrom'];
}
export interface CanvasVersionHead {
  readonly latestVersionId: string; readonly sequence: number; readonly changedAt: number;
  readonly dirtySince: number | null; readonly inverse: Uint8Array | null;
  readonly bytesSinceAnchor: number; readonly usedBytes: number; readonly overBudgetBytes: number;
}
export interface CanvasVersionHistoryPorts {
  readonly readSnapshot: (documentId: string) => CanvasSnapshot;
  readonly protectedAssetIds: (documentId: string) => readonly string[];
  readonly assetByteFacts: (documentId: string, assetIds: readonly string[]) => readonly DocumentAssetByteFact[];
  /** 加入当前 SQLite 事务；调用方合并 current/undo/groups/pending 可达性后登记并释放归属。 */
  readonly reconcileHistoryAssets: (documentId: string, assetIds: readonly string[]) => void;
  readonly reportFailure: (documentId: string, error: unknown) => void;
  readonly budgetChanged?: (status: CanvasVersionBudgetStatus) => void;
}
export type { CanvasVersionBudgetStatus } from '../../../../shared';
export interface CanvasVersionHistoryOptions {
  readonly database: CanvasDatabase; readonly ports: CanvasVersionHistoryPorts;
  readonly budgetBytes?: number; readonly now?: () => number;
}
