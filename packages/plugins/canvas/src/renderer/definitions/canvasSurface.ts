import type { EmbeddedMarkdownEditor, EmbeddedMarkdownEditorOptions } from '@plugin/renderer/embeddedMarkdownEditor';
import type { Ref } from 'vue';
import type { CanvasCamera, CanvasCard, CanvasCardId, CanvasElement, CanvasElementId, CanvasPoint } from '@plugin/canvas/shared';
import type { CanvasDocumentPort } from '../features/canvasDocument';
import type { CanvasArrangementPort } from '../features/layoutCommands';
import type { CanvasRestoredMessage } from './canvasHistoryRestoration';

export interface CanvasSurfaceOptions {
  readonly host: HTMLElement;
  readonly editorHost: HTMLElement;
  readonly stagingHost: HTMLElement;
  readonly documentId: string;
}
export interface CanvasSurfacePorts {
  readonly document: CanvasDocumentPort;
  readonly arrangement?: CanvasArrangementPort;
  createEditor(options: EmbeddedMarkdownEditorOptions): EmbeddedMarkdownEditor;
  markDirty(dirty: boolean): void;
  subscribeRestored(listener: (message: CanvasRestoredMessage) => void): () => void;
  createContent?(card: CanvasCard, signal: AbortSignal): Promise<HTMLElement>;
  readContentKey?(card: CanvasCard): string;
  readDocumentTitles?(): ReadonlyMap<string, string>;
  readThumbnailCards?(cards: readonly CanvasCard[]): ReadonlySet<CanvasCardId>;
  refreshVisibleContent?(cards: readonly CanvasCard[]): void;
  retryContent?(): void;
  refreshReferences?(cards: readonly CanvasCard[]): Promise<void>;
  subscribeContent?(listener: (failure: Error | null) => void): () => void;
  prepareClipboard?(ids: readonly CanvasElementId[]): Promise<{ readonly elements: readonly CanvasElement[]; readonly text: string }>;
  pasteImages?(files: readonly File[], point: CanvasPoint): Promise<void>;
  openCard?(card: CanvasCard): Promise<void>;
  resolveImageSource?(source: string): Promise<string>;
}
export interface CanvasSurfaceState {
  readonly camera: Readonly<Ref<CanvasCamera>>;
  readonly error: Readonly<Ref<string | null>>;
  readonly context: Readonly<Ref<{ readonly point: CanvasPoint; readonly id: CanvasCardId | null } | null>>;
  readonly renderNotice: Readonly<Ref<string | null>>;
  setCamera(camera: CanvasCamera): void;
  fail(message: string): void;
  clearFailure(): void;
  setContext(context: { readonly point: CanvasPoint; readonly id: CanvasCardId | null } | null): void;
  setRenderNotice(message: string | null): void;
}
