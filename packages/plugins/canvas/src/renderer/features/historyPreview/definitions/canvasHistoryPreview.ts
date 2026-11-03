import type { Ref } from 'vue';
import type { CanvasVersionBudgetStatus } from '@plugin/canvas/shared';
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
