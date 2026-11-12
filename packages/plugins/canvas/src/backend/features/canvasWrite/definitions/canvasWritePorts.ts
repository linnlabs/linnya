import type { CanvasSnapshot, CanvasTextDocument } from '../../../../shared';
import type { CanvasWriteTextMeasurement } from './canvasPreparedOperation';
import type { CanvasCliOperation } from '../../../../shared/cli/definitions/canvasCli';
import type { DocumentImageAsset } from '@app/schemas';

export interface CanvasWritePorts {
  parseText(
    markdown: string,
    baseline?: {
      readonly elementId: string;
      readonly revision: number;
      readonly mode: 'replace' | 'append';
    }
  ): Promise<CanvasTextDocument>;
  resolveDocument(path: string): Promise<string>;
  /** 工作区标签名换成稳定 ID，保持给出的顺序；没有的标签整批拒绝，画布不新建标签。 */
  resolveTags(names: readonly string[], field: 'tags' | 'status'): string[];
  prepareImage(
    file: string,
    dryRun: boolean
  ): Promise<Pick<DocumentImageAsset, 'assetId' | 'displayWidth' | 'displayHeight'>>;
  measure(
    cards: readonly CanvasWriteTextMeasurement[],
    signal: AbortSignal
  ): Promise<readonly { readonly ref: string; readonly height: number }[]>;
}
export interface CanvasWritePreparation {
  readonly snapshot: CanvasSnapshot;
  readonly operations: readonly CanvasCliOperation[];
  readonly dryRun: boolean;
  readonly signal: AbortSignal;
}
