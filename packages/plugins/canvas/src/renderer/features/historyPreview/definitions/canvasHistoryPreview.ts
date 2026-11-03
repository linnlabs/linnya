import type { Ref } from 'vue';
export interface CanvasHistoryPreviewState {
  readonly phase: Readonly<Ref<'loading' | 'ready' | 'failed'>>;
  readonly error: Readonly<Ref<string | null>>;
  loading(): void;
  ready(): void;
  fail(message: string): void;
}
