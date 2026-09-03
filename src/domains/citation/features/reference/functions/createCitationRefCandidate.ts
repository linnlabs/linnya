import { createHash } from 'node:crypto';

export const CITATION_REF_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const CITATION_REF_LENGTH = 6;
export const MAX_CITATION_REF_COLLISION_ATTEMPTS = 20;

/** 只生成某次尝试的候选值；是否可占用由 Conversation claim 事务决定。 */
export function createCitationRefCandidate(sourceIdentity: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error('Citation ref candidate attempt 必须是非负整数。');
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([sourceIdentity, attempt]))
    .digest();
  let ref = '';
  for (let index = 0; index < CITATION_REF_LENGTH; index += 1) {
    ref += CITATION_REF_CHARSET[(digest[index] ?? 0) % CITATION_REF_CHARSET.length];
  }
  return ref;
}
