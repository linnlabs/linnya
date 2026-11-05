import type { Editor } from '@tiptap/core';
import type { Ref } from 'vue';

/** 文档装载只消费调用方的窄端口，不读取 Workspace store 内部结构。 */
export interface EditorDocumentLoadOptions {
  readonly editor: Editor;
  readonly documentId: string;
  readonly documentName: string;
  readonly throwIfCancelled?: () => void;
  readonly stores: {
    readonly fileStore: {
      readonly currentFilePath: string | null;
      setDirty(dirty: boolean): void;
      setFilePath(documentId: string, documentName: string): void;
    };
    readonly notificationStore: {
      show(message: string, type: 'error', duration: number): void;
    };
    readonly annotationStore: Readonly<Ref<{ loadAnnotations(): void } | null | undefined>>;
  };
}
