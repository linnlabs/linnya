import { createHash } from 'node:crypto';
import path from 'node:path';

export function createManagedSlidesRenderDirectory(presentationId: string): string {
  const identity = createHash('sha256').update(presentationId).digest('hex').slice(0, 24);
  return path.posix.join('slides-renders', `presentation-${identity}`);
}
