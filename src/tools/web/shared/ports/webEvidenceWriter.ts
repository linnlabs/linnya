/**
 * Web → Evidence 的唯一写入契约。
 *
 * Web 业务只依赖这个窄 port，不感知 Evidence bundle 联合类型、磁盘路径或 ToolContext 投影细节。
 */

import type { WebEvidenceCaptureItem } from '../definitions/webEvidenceCapture';

export interface WebEvidenceWriter {
  save(params: {
    query: string;
    summary?: string;
    items: readonly WebEvidenceCaptureItem[];
  }): Promise<{ bundleId: string }>;
}
