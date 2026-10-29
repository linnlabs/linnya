import { slidesApi } from '../../../services/slidesApi';
/** 图片只经一次 Host 接管；返回尺寸和身份，不把图片字节放进作者源码。 */
export async function importSlideImage(documentId: string, file: File): Promise<{ assetId: string; width: number; height: number }> {
  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width; const height = bitmap.height;
  bitmap.close();
  const assetId = await slidesApi.importImage(documentId, dataUri.slice(dataUri.indexOf(',') + 1));
  return { assetId, width, height };
}
