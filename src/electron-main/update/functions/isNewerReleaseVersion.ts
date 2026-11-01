const RELEASE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version: string): readonly [number, number, number] | null {
  const match = RELEASE_VERSION.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * stable 渠道只接受正式版本号，且必须严格大于当前版本。
 * 预发布、格式不对、相同或更旧的版本都视为“没有更新”，不进入下载。
 */
export function isNewerReleaseVersion(candidate: string, current: string): boolean {
  const next = parse(candidate);
  const now = parse(current);
  if (!next || !now) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== now[index]) return next[index] > now[index];
  }
  return false;
}
