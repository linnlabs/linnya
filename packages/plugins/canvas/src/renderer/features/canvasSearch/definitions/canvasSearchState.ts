import type { Ref } from 'vue';
export interface CanvasSearchState {
  readonly open: Readonly<Ref<boolean>>;
  readonly query: Readonly<Ref<string>>;
  readonly index: Readonly<Ref<number>>;
  show(): void;
  close(): void;
  setQuery(query: string): void;
  select(index: number): void;
}
