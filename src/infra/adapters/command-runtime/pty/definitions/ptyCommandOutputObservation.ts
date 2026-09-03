import type { ProcessOutputCursor } from '@app/schemas/commands';
import type {
  CommandProcessOutputObservationPort,
  PtyTerminalScreenProjection,
} from '../../../../../domains/commands';

export interface PtyCommandOutputObservationLimits {
  readonly maxSnapshots: number;
  /** 每份屏幕预览保留的 JavaScript UTF-16 单位上限。 */
  readonly maxCharactersPerSnapshot: number;
  readonly maxLinesPerSnapshot: number;
}

export interface PtyCommandOutputObservationController
  extends CommandProcessOutputObservationPort {
  accept(snapshot: {
    readonly stableScreenText: string;
    readonly screen: PtyTerminalScreenProjection;
  }): void;
  markProjectionFailed(): void;
  close(finalSnapshot?: {
    readonly stableScreenText: string;
    readonly screen: PtyTerminalScreenProjection;
  }): void;
  readonly currentCursor: ProcessOutputCursor;
}
