import { useNotificationStore } from '@/app/notification';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';

interface EmbedImageByPickInput {
  readonly editor: {
    chain: () => {
      focus: () => {
        insertImage: (attrs: { src: string; alt?: string }) => { run: () => boolean };
      };
    };
  };
  readonly dialogTitle: string;
  readonly imageFilterName: string;
  readonly insertedMessageKey: 'editor.menu.toast.imageInserted' | 'editor.slash.toast.imageInserted';
  readonly unavailableMessageKey: 'editor.menu.toast.imageDialogUnavailable' | 'editor.slash.toast.imageDialogUnavailable';
  readonly failedMessageKey: 'editor.menu.toast.imageFlowFailed' | 'editor.slash.toast.imageFlowFailed';
}

interface EmbedImageByFileInput {
  readonly editorView: {
    state: {
      schema: {
        nodes: {
          imageBlock?: {
            create: (attrs: { src: string; alt?: string }) => unknown;
          };
        };
      };
    };
    dispatch: (transaction: unknown) => void;
  };
  readonly file: File;
  readonly insertAt: number;
  readonly createTransaction: (state: EmbedImageByFileInput['editorView']['state'], imageNode: unknown, pos: number) => unknown;
}

async function getCurrentDocumentNodeId(): Promise<string | null> {
  const { useFileStore } = await import('../../../../../shared/stores/file');
  const documentNodeId = useFileStore().currentFilePath;
  return typeof documentNodeId === 'string' && documentNodeId.trim().length > 0
    ? documentNodeId.trim()
    : null;
}

function requireImageEmbedApi(): Pick<Window['electronAPI'], 'embedImageBytes' | 'pickAndEmbedImage'> | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const electronAPI = window.electronAPI;
  if (
    !electronAPI ||
    typeof electronAPI.embedImageBytes !== 'function' ||
    typeof electronAPI.pickAndEmbedImage !== 'function'
  ) {
    return null;
  }
  return electronAPI;
}

function getFileExtension(file: File): string {
  const fromName = file.name.match(/\.([^.]+)$/)?.[1];
  if (fromName) return fromName;
  const fromType = file.type.split('/')[1];
  return fromType || '';
}

export async function pickEmbedAndInsertImage(input: EmbedImageByPickInput): Promise<void> {
  const notificationStore = useNotificationStore();
  const editorMessage = resolveCurrentEditorMessage;
  const documentNodeId = await getCurrentDocumentNodeId();
  const mediaApi = requireImageEmbedApi();

  if (!documentNodeId || !mediaApi) {
    notificationStore.show(editorMessage(input.unavailableMessageKey), 'error');
    return;
  }

  try {
    const result = await mediaApi.pickAndEmbedImage({
      documentNodeId,
      title: input.dialogTitle,
      imageFilterName: input.imageFilterName,
    });
    if (result.canceled) return;
    if (!result.success || !result.locator) {
      notificationStore.show(editorMessage(input.failedMessageKey), 'error');
      return;
    }

    const fileName = result.fileName || 'image';
    input.editor.chain().focus().insertImage({ src: result.locator, alt: fileName }).run();
    notificationStore.show(editorMessage(input.insertedMessageKey, { fileName }));
  } catch (error) {
    console.error('[ImageBlock] 插入图片流程出错:', error);
    notificationStore.show(editorMessage(input.failedMessageKey), 'error');
  }
}

export async function embedDroppedOrPastedImage(input: EmbedImageByFileInput): Promise<boolean> {
  const documentNodeId = await getCurrentDocumentNodeId();
  const mediaApi = requireImageEmbedApi();
  if (!documentNodeId || !mediaApi) {
    console.error('[ImageBlock] 无法嵌入图片：当前文档或 media API 不可用。');
    return false;
  }

  const imageBlock = input.editorView.state.schema.nodes.imageBlock;
  if (!imageBlock) {
    console.error('[ImageBlock] 找不到 imageBlock 节点类型，无法插入图片。');
    return false;
  }

  try {
    const bytes = await input.file.arrayBuffer();
    const result = await mediaApi.embedImageBytes({
      documentNodeId,
      bytes,
      ext: getFileExtension(input.file),
      fileName: input.file.name,
    });
    if (!result.success || !result.locator) {
      console.error('[ImageBlock] 嵌入图片失败:', result.error);
      return false;
    }

    const imageNode = imageBlock.create({
      src: result.locator,
      alt: result.fileName || input.file.name,
    });
    const transaction = input.createTransaction(input.editorView.state, imageNode, input.insertAt);
    input.editorView.dispatch(transaction);
    return true;
  } catch (error) {
    console.error('[ImageBlock] 嵌入并插入图片失败:', error);
    return false;
  }
}
