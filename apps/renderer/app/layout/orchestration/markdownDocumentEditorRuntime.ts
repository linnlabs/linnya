import { nextTick, watch } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import type {
  MarkdownDocumentEditorRuntimePort,
  ReadyMarkdownDocumentEditor,
  WaitForMarkdownDocumentEditorOptions,
} from '@/shared/ports/markdownDocumentEditorRuntimePort';

const DEFAULT_EDITOR_READY_TIMEOUT = 8000;

function isReadyEditor(
  editor: ReturnType<ReturnType<typeof useUIStore>['getEditor']>,
): editor is ReadyMarkdownDocumentEditor {
  return Boolean(editor && !editor.isDestroyed);
}

function createAbortError(): Error {
  return new Error('[markdownDocumentEditorRuntime] 等待 Markdown editor ready 已取消');
}

export function createMarkdownDocumentEditorRuntime(): MarkdownDocumentEditorRuntimePort {
  return {
    getReadyEditor() {
      const editor = useUIStore().getEditor();
      return isReadyEditor(editor) ? editor : null;
    },

    async waitForReadyEditor(options: WaitForMarkdownDocumentEditorOptions = {}) {
      const uiStore = useUIStore();
      const timeoutMs = options.timeoutMs ?? DEFAULT_EDITOR_READY_TIMEOUT;

      await nextTick();
      const currentEditor = uiStore.getEditor();
      if (isReadyEditor(currentEditor)) {
        return currentEditor;
      }

      if (options.signal?.aborted) {
        throw createAbortError();
      }

      return new Promise<ReadyMarkdownDocumentEditor>((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          stopWatch();
          window.clearTimeout(timeoutId);
          options.signal?.removeEventListener('abort', handleAbort);
        };

        const finish = (editor: ReadyMarkdownDocumentEditor) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(editor);
        };

        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        const inspect = () => {
          const editor = uiStore.getEditor();
          if (isReadyEditor(editor)) {
            finish(editor);
          }
        };

        const handleAbort = () => {
          fail(createAbortError());
        };

        const timeoutId = window.setTimeout(() => {
          fail(new Error(
            '[markdownDocumentEditorRuntime] Markdown editor is not ready within timeout',
          ));
        }, timeoutMs);

        const stopWatch = watch(
          () => uiStore.editorInstanceVersion,
          () => inspect(),
          { flush: 'post' },
        );

        options.signal?.addEventListener('abort', handleAbort, { once: true });
        inspect();
      });
    },
  };
}
