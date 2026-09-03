import JSZip from 'jszip';
import {
  createPresentationPageImageFileName,
  type PresentationRasterizedPage,
} from '../../presentationPageRasterization';

/** PNG 本身已经压缩，ZIP 使用 STORE，避免导出时重复耗费 CPU。 */
export async function buildPresentationImageArchive(
  pages: readonly PresentationRasterizedPage[],
): Promise<Uint8Array> {
  const archive = new JSZip();
  for (const page of pages) {
    archive.file(createPresentationPageImageFileName(page.slideNumber), page.bytes, {
      binary: true,
      compression: 'STORE',
    });
  }
  return await archive.generateAsync({ type: 'uint8array', compression: 'STORE' });
}
