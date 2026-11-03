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
  readonly precise: boolean;
  readonly dark: boolean;
  readonly regions: readonly CanvasRectangle[];
}

export interface CanvasRasterPending { readonly key: string; readonly contentKey: string; readonly scale: number; readonly completion: Promise<boolean> }

export type CanvasRasterIdentity = Omit<CanvasRasterDemand, 'regions' | 'jobKey'> & { readonly physicalWidth: number };
export interface CanvasRasterFrame { readonly count: number; readonly font: string; readonly precise?: boolean }
