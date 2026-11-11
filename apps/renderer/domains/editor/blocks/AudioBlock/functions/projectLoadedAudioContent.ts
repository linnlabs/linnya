import type { AudioBlockCompleteContent } from '../types/audioBlock';
import type { AudioContentState } from '../definitions/audioActions';
import { parseTranscriptContent } from './parseTranscriptContent';

/** 只投影存在的子内容；缺失内容保留旧草稿，与既有加载行为一致。 */
export function projectLoadedAudioContent(
  data: AudioBlockCompleteContent
): Partial<AudioContentState> {
  const updates: Partial<AudioContentState> = { isLoaded: true };
  if (data.note)
    Object.assign(updates, {
      notesContent: data.note.content_html || '',
      notesCreatedAt: data.note.created_at,
      notesLastEditedAt: data.note.updated_at,
    });
  if (data.transcript)
    Object.assign(updates, {
      transcriptContent: parseTranscriptContent(data.transcript.content_json),
      transcriptCreatedAt: data.transcript.created_at,
      transcriptLastEditedAt: data.transcript.updated_at,
      translationLanguage: data.transcript.translation_language || null,
      translationVisible: !!data.transcript.translation_visible,
      textColumnWidth:
        typeof data.transcript.text_column_width === 'number'
          ? data.transcript.text_column_width
          : 50,
    });
  if (data.summary)
    Object.assign(updates, {
      summaryContent: data.summary.content_html || '',
      summaryCreatedAt: data.summary.created_at,
      summaryLastEditedAt: data.summary.updated_at,
    });
  return updates;
}
