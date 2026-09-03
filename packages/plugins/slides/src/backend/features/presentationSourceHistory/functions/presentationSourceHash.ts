import { createHash } from 'node:crypto';

/** current document 与 revision 链共同使用的源码身份算法。 */
export function hashPresentationSource(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}
