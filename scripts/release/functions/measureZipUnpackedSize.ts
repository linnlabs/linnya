import JSZip from 'jszip';

/**
 * 解压后全部文件的真实字节数之和（逐条目解压计数，不读 zip 头声明值）。
 * 写入 catalog 的 unpackedSize：Desktop 安装前据此预检空间，解压时超过即拒绝。
 */
export async function measureZipUnpackedSize(zipBytes: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(zipBytes);
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    total += (await entry.async('nodebuffer')).byteLength;
  }
  return total;
}
