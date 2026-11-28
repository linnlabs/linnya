import { createHash } from 'node:crypto';
import path from 'node:path';

/** 与截图工作集同样按文稿 ID 摘要分目录，不把原始 ID 或标题放进路径。 */
export function createManagedSlidesExportDirectory(presentationId: string): string {
  const identity = createHash('sha256').update(presentationId).digest('hex').slice(0, 24);
  return path.posix.join('slides-exports', `presentation-${identity}`);
}
