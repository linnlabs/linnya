import type { ImportedSlideImage } from '../definitions/importedSlideImage';
import { logSlidesVerbose } from '../../../shared/diagnosticLogging';
import { slidesApi } from '../../../services/slidesApi';
/** 图片只经一次 Host 接管；返回尺寸和身份，不把图片字节放进作者源码。 */
export async function importSlideImage(documentId: string, file: File): Promise<ImportedSlideImage> {
  const startedAt = performance.now();
  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
  const readAt = performance.now();
  const imported = await slidesApi.importImage(documentId, dataUri.slice(dataUri.indexOf(',') + 1));
  logSlidesVerbose('ImageImport', 'asset adopted', { documentId, bytes: file.size,
    readMs: readAt - startedAt, adoptionMs: performance.now() - readAt });
  return { ...imported, previewSource: dataUri };
}
