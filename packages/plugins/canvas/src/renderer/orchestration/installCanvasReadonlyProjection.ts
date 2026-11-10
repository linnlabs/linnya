import { watch, type Ref } from 'vue';
import type { EmbeddedMarkdownEditor } from '@plugin/renderer/embeddedMarkdownEditor';
/** 只读降级停止正在进行的写交互并释放字段声明，草稿正文留在内存供用户读取。 */
export function installCanvasReadonlyProjection(options: {
  readonly readonly: Readonly<Ref<boolean>>;
  readonly editable: Pick<EmbeddedMarkdownEditor, 'setEditable'>;
  readonly clearPreview: () => void;
  readonly cancelResize: () => void;
  readonly suspendEditor: () => Promise<void>;
  readonly suspendConnections: () => Promise<void>;
  readonly cancelDrag: () => Promise<void>;
  readonly cancelLayout: () => Promise<void>;
  readonly report: (failure: unknown) => void;
}) {
  return watch(
    options.readonly,
    readonly => {
      options.editable.setEditable(!readonly);
      if (!readonly) return;
      options.clearPreview();
      options.cancelResize();
      void Promise.all([
        options.suspendEditor(),
        options.suspendConnections(),
        options.cancelDrag(),
        options.cancelLayout(),
      ]).catch(options.report);
    },
    { immediate: true }
  );
}
