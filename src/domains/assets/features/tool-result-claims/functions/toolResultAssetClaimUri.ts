const CLAIM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

export function createToolResultAssetClaimUri(claimId: string): string {
  if (!CLAIM_ID_PATTERN.test(claimId)) {
    throw new Error('Tool result asset claim ID is invalid');
  }
  return `artifact://tool-results/${claimId}`;
}

export function parseToolResultAssetClaimUri(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  const claimId = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : '';
  if (
    parsed.protocol !== 'artifact:'
    || parsed.hostname !== 'tool-results'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.port !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
    || !CLAIM_ID_PATTERN.test(claimId)
    || uri !== `artifact://tool-results/${claimId}`
  ) {
    return null;
  }
  return claimId;
}

