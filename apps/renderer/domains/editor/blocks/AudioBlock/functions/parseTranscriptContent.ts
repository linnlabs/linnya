import { sanitizeTranscriptDocument } from '../types/audioBlock';
import type { TranscriptDocument } from '../types/audioBlock';
export function parseTranscriptContent(contentJson: string | null): TranscriptDocument | null {
  if (!contentJson) return null;

  try {
    const parsed = JSON.parse(contentJson);
    return sanitizeTranscriptDocument(parsed);
  } catch (error) {
    console.warn('[AudioBlockRepository] Failed to parse transcript JSON:', error);
    return null;
  }
}
