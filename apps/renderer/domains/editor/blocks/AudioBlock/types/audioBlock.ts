/**
 * @file audioBlock.ts
 * @description AudioBlock 的类型定义与类型守卫
 */

import type { AudioBlockLocalizedMessage } from '../functions/audioBlockPresentation';
import type { AudioBlockMissingReason, AudioBlockSaveStatus } from '../functions/audioBlockMediaState';

/**
 * 转录文档的 ProseMirror JSON 结构
 */
export interface TranscriptDocument {
  type: 'transcriptDocument';
  content: TranscriptSegment[];
}

export interface TranscriptSegment {
  type: 'transcriptSegment';
  attrs: {
    id: string;
    timestamp: string;
    startTime: number;
    translationVisible: boolean;
    textColumnWidth: number;
  };
  content: (TranscriptText | TranscriptTranslation)[];
}

export interface TranscriptText {
  type: 'transcriptText';
  content?: Array<{ type: 'text'; text: string }>;
}

export interface TranscriptTranslation {
  type: 'transcriptTranslation';
  content?: Array<{ type: 'text'; text: string }>;
}

/**
 * AudioBlock 的状态结构
 */
export interface AudioBlockState {
  // 录音与播放的运行时状态
  isRecording: boolean;
  isPaused: boolean;
  recordingTime: number;
  currentPlayTime: number;
  seekToTimeRequest: { time: number; timestamp: number } | null;
  
  // UI 状态
  statusMessage: string | AudioBlockLocalizedMessage;
  canRecord: boolean;
  showPlayer: boolean;
  processingState: 'idle' | 'loading' | 'ready' | 'error' | 'recording' | 'processing' | 'save_failed';
  errorMessage: string | AudioBlockLocalizedMessage | null;
  
  // 设备状态
  microphoneDevice: any | null;
  deviceCheckCompleted: boolean;
  mediaStream: MediaStream | null;
  mediaRecorder: MediaRecorder | null;
  audioChunks: Blob[];
  
  // 文件状态
  src: string | null;
  isTempSrc: boolean;
  audioFileObjectUrl: string | null;
  audioFilePath: string | null;
  duration: number;
  mimeType: string | null;
  isFinalized: boolean;
  saveStatus: AudioBlockSaveStatus | null;
  audioLoadFailed: boolean;
  audioMissingReason: AudioBlockMissingReason | null;
  
  // 内容面板状态
  activeTab: 'notes' | 'transcript' | 'summary';
  isPanelVisible: boolean;
  
  // 笔记内容
  notesContent: string;
  notesCreatedAt: number | null;
  notesLastEditedAt: number | null;
  
  // 转录内容
  transcriptContent: TranscriptDocument | null;
  transcriptCreatedAt: number | null;
  transcriptLastEditedAt: number | null;
  transcriptionState: 'idle' | 'loading' | 'success' | 'error';
  transcriptionText: string;
  transcriptionError: string | null;
  
  // 翻译状态
  translationLanguage: string | null;
  translationVisible: boolean;
  textColumnWidth: number;
  
  // 摘要内容
  summaryContent: string;
  summaryCreatedAt: number | null;
  summaryLastEditedAt: number | null;
}

/**
 * AudioBlock 子内容类型
 */
export type AudioBlockSubContentType = 'notes' | 'transcript' | 'summary';

/**
 * 从数据库加载的完整 AudioBlock 内容
 */
export interface AudioBlockCompleteContent {
  block: any | null;
  transcript: {
    content_json: string;
    translation_language: string | null;
    translation_visible: number;
    text_column_width: number;
    created_at: number;
    updated_at: number;
  } | null;
  note: {
    content_html: string;
    created_at: number;
    updated_at: number;
  } | null;
  summary: {
    content_html: string;
    created_at: number;
    updated_at: number;
  } | null;
}

/**
 * 类型守卫：检查对象是否为有效的 TranscriptDocument
 */
export function isTranscriptDocument(obj: any): obj is TranscriptDocument {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    obj.type === 'transcriptDocument' &&
    Array.isArray(obj.content)
  );
}

/**
 * 类型守卫：检查对象是否为有效的 TranscriptSegment
 */
export function isTranscriptSegment(obj: any): obj is TranscriptSegment {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    obj.type === 'transcriptSegment' &&
    typeof obj.attrs === 'object' &&
    Array.isArray(obj.content)
  );
}

/**
 * 创建一个安全的空 TranscriptDocument
 */
export function createEmptyTranscriptDocument(): TranscriptDocument {
  return {
    type: 'transcriptDocument',
    content: [],
  };
}

/**
 * 验证并修复 TranscriptDocument（如果结构损坏，返回空文档）
 */
export function sanitizeTranscriptDocument(doc: any): TranscriptDocument {
  if (isTranscriptDocument(doc)) {
    return doc;
  }
  console.warn('[AudioBlock Types] Invalid TranscriptDocument structure, returning empty document:', doc);
  return createEmptyTranscriptDocument();
}
