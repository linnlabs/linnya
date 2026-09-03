import type { LiveEvidenceBundleRecordV1 } from '../definitions/evidenceBundleRecord';

export interface EvidenceBundleWriterPort {
  write(params: {
    readonly conversationId: string;
    readonly instanceId: string;
    readonly bundleId: string;
    readonly record: LiveEvidenceBundleRecordV1;
  }): Promise<{ readonly filePath: string }>;
}
