import type { DocumentPreviewImageRequest, DocumentPreviewImageResult } from '@app/schemas';
import type { DocumentPreviewImageHandle } from '@linnya/plugin-host-contract/renderer/documentPreview';
import { readDocumentPreviewImage } from '@plugin/renderer/documentPreview';

/**
 * 预览图片在 Renderer 里的唯一持有处：同一张图的同一档，悬停预览、画布卡和详情共用一个 blob: 地址，
 * 只向 Backend 取一次，也只占一份内存。按使用方计数，最后一个释放后立即撤销地址；
 * 再次需要时重新取（Backend 有缩图的磁盘缓存，只是一次读盘）。
 * 首屏换全文时旧表面在新表面就位后才释放，所以两者共有的图片不会被撤销重取。
 */
export function createDocumentPreviewImageStore(
  read: (request: DocumentPreviewImageRequest) => Promise<DocumentPreviewImageResult> =
    readDocumentPreviewImage
) {
  const entries = new Map<string, { users: number; readonly url: Promise<string> }>();
  return {
    async acquire(request: DocumentPreviewImageRequest): Promise<DocumentPreviewImageHandle> {
      const key = JSON.stringify([
        request.projectId,
        request.documentId,
        request.source,
        request.maxEdgePx,
      ]);
      let entry = entries.get(key);
      if (!entry) {
        entry = {
          users: 0,
          url: read(request).then(result => {
            if (!result) throw new Error('Document preview image is unavailable');
            return URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType }));
          }),
        };
        entries.set(key, entry);
      }
      const held = entry;
      held.users++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (--held.users > 0) return;
        if (entries.get(key) === held) entries.delete(key);
        // 读取失败的条目没有地址可撤销。
        void held.url.then(URL.revokeObjectURL, () => undefined);
      };
      try {
        return { url: await held.url, release };
      } catch (failure) {
        release();
        throw failure;
      }
    },
  };
}

/** App 内共用的一份；Host 自己的预览和经插件端口取图的消费方都走它。 */
export const documentPreviewImageStore = createDocumentPreviewImageStore();
