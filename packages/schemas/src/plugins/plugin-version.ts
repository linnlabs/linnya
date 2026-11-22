/**
 * 插件版本是纯数字点分（`1.2.3`），缺位按 0 比较。Host 与 Renderer 共用这一份规则：
 * 安装、升级计划、catalog 选版本与商店“有新版本”判断必须一致。非法版本返回 null，由调用方决定如何处理。
 */
export function compareDottedVersions(left: string, right: string): -1 | 0 | 1 | null {
  const leftParts = parseDottedVersion(left);
  const rightParts = parseDottedVersion(right);
  if (!leftParts || !rightParts) return null;

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

function parseDottedVersion(version: string): number[] | null {
  if (!/^\d+(?:\.\d+)*$/.test(version)) return null;
  return version.split('.').map((part) => Number(part));
}
