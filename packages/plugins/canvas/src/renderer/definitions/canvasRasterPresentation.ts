import type { CanvasCard, CanvasRectangle } from '../../shared';
import type { CanvasAppearance, CanvasKernel } from '../kernel';

export interface CanvasRasterPresentationOptions {
  readonly host: HTMLElement;
  readonly kernel: CanvasKernel;
  readonly readAppearance: () => CanvasAppearance;
  readonly reportFailure: (message: string) => void;
  readonly createContent?: (card: CanvasCard, signal: AbortSignal) => Promise<HTMLElement>;
  readonly readContentKey?: (card: CanvasCard) => string;
  /** 离屏验证器有独立paint时钟；正式可见表面跟随Page Visibility暂停。 */
  readonly suspendWhenHidden?: boolean;
}
export interface CanvasRasterDemand {
  readonly card: CanvasCard;
  readonly key: string;
  readonly jobKey: string;
  readonly content: string;
  readonly externalKey: string;
  readonly scale: number;
  readonly dark: boolean;
  readonly regions: readonly CanvasRectangle[];
}
