import type { EmbeddedMarkdownEditor, EmbeddedMarkdownEditorOptions } from '@plugin/renderer/embeddedMarkdownEditor';
import type { Ref } from 'vue';
import type { CanvasCamera, CanvasCard, CanvasCardId, CanvasEdgeId, CanvasElement, CanvasElementId, CanvasPoint, CanvasRectangle } from '@plugin/canvas/shared';
import type { CanvasDocumentPort } from '../features/canvasDocument';
import type { CanvasArrangementPort } from '../features/layoutCommands';
import type { CanvasRestoredMessage } from './canvasHistoryRestoration';
export type CanvasViewportSize = Pick<CanvasRectangle, 'width' | 'height'>;

export interface CanvasSurfaceOptions {
  readonly host: HTMLElement;
  readonly editorHost: HTMLElement;
  readonly stagingHost: HTMLElement;
  readonly documentId: string;
  readonly descriptionId?: string;
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
  cardOpened?(id: CanvasCardId): void;
  resolveImageSource?(source: string): Promise<string>;
}
export interface CanvasSurfaceState {
  readonly camera: Readonly<Ref<CanvasCamera>>;
  readonly error: Readonly<Ref<string | null>>;
  readonly context: Readonly<Ref<{ readonly point: CanvasPoint; readonly id: CanvasCardId | null; readonly edgeId?: CanvasEdgeId | null } | null>>;
  readonly renderNotice: Readonly<Ref<string | null>>;
  readonly hoveredId: Readonly<Ref<CanvasCardId | null>>;
  readonly detailId: Readonly<Ref<CanvasCardId | null>>;
  readonly displayVersion: Readonly<Ref<number>>;
  /** 当前表面CSS像素，不是世界坐标尺寸。 */
  readonly viewport: Readonly<Ref<CanvasViewportSize>>;
  setCamera(camera: CanvasCamera): void;
  fail(message: string): void;
  clearFailure(): void;
  setContext(context: { readonly point: CanvasPoint; readonly id: CanvasCardId | null; readonly edgeId?: CanvasEdgeId | null } | null): void;
  setHovered(id: CanvasCardId | null): void;
  setDetailVisible(id: CanvasCardId, visible: boolean): void;
  advanceDisplay(): void;
  setViewport(value: CanvasViewportSize): void;
  setRenderNotice(message: string | null): void;
}
