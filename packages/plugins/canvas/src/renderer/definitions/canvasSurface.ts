import type { EmbeddedMarkdownEditor, EmbeddedMarkdownEditorOptions } from '@plugin/renderer/embeddedMarkdownEditor';
import type { Ref } from 'vue';
import type { CanvasCamera, CanvasCardId, CanvasPoint } from '@plugin/canvas/shared';
import type { CanvasDocumentPort } from '../features/canvasDocument';

export interface CanvasSurfaceOptions {
  readonly host: HTMLElement;
  readonly editorHost: HTMLElement;
  readonly stagingHost: HTMLElement;
  readonly documentId: string;
}
export interface CanvasSurfacePorts {
  readonly document: CanvasDocumentPort;
  createEditor(options: EmbeddedMarkdownEditorOptions): EmbeddedMarkdownEditor;
  markDirty(dirty: boolean): void;
}
export interface CanvasSurfaceState {
  readonly camera: Readonly<Ref<CanvasCamera>>;
  readonly error: Readonly<Ref<string | null>>;
  readonly context: Readonly<Ref<{ readonly point: CanvasPoint; readonly id: CanvasCardId | null } | null>>;
  setCamera(camera: CanvasCamera): void;
  fail(message: string): void;
  setContext(context: { readonly point: CanvasPoint; readonly id: CanvasCardId | null } | null): void;
}
