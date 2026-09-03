const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** 只接受规范的 v1 asset URI，拒绝 query、fragment 和编码歧义。 */
export function parseWorkspaceAssetUri(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }

  const assetId = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : '';
  if (
    parsed.protocol !== 'asset:'
    || parsed.hostname !== 'assets'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.port !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
    || !ASSET_ID_PATTERN.test(assetId)
    || uri !== `asset://assets/${assetId}`
  ) {
    return null;
  }

  return assetId;
}
