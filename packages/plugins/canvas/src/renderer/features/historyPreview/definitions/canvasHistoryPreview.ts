import type { Ref } from 'vue';
import type { CanvasSnapshot, CanvasVersionBudgetStatus } from '@plugin/canvas/shared';
import type { CanvasAppearance, CanvasKernel } from '../../../kernel';
import type { CanvasCardContent } from '../../cardMedia';
export interface CanvasHistoryPreviewOptions {
  readonly host: HTMLElement;
  readonly createContent: (documentId: string) => CanvasCardContent;
  readonly read: (documentId: string, versionId: string) => Promise<CanvasSnapshot>;
  readonly readBudget: (documentId: string) => Promise<CanvasVersionBudgetStatus>;
  readonly readAppearance: () => CanvasAppearance;
  readonly observeResolution: (changed: () => void) => () => void;
  readonly createRaster: (options: {
    readonly kernel: CanvasKernel;
    readonly createContent: CanvasCardContent['create'];
    readonly readContentKey: CanvasCardContent['contentKey'];
    readonly readAppearance: () => CanvasAppearance;
    readonly reportFailure: (message: string) => void;
  }) => { refresh(): void; dispose(): void };
}
export interface CanvasHistoryPreviewState {
  readonly phase: Readonly<Ref<'loading' | 'ready' | 'failed'>>;
  readonly error: Readonly<Ref<string | null>>;
  readonly budget: Readonly<Ref<CanvasVersionBudgetStatus | null>>;
  readonly renderNotice: Readonly<Ref<string | null>>;
  loading(): void;
  ready(): void;
  fail(message: string): void;
  installBudget(status: CanvasVersionBudgetStatus): void;
  setRenderNotice(message: string | null): void;
}
