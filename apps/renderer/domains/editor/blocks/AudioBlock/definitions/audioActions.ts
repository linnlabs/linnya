import type { AudioBlockState, TranscriptDocument } from '../types/audioBlock';
import type { AudioBlockLocalizedMessage } from '../functions/audioBlockPresentation';

export interface AudioContentState {
  notesContent: string;
  notesCreatedAt: number | null;
  notesLastEditedAt: number | null;
  transcriptContent: TranscriptDocument | null;
  transcriptCreatedAt: number | null;
  transcriptLastEditedAt: number | null;
  translationLanguage: string | null;
  translationVisible: boolean;
  textColumnWidth: number;
  summaryContent: string;
  summaryCreatedAt: number | null;
  summaryLastEditedAt: number | null;
  isLoaded: boolean;
}
export interface AudioMicrophoneDevice {
  deviceId?: string;
  label: string;
  kind: MediaDeviceKind;
}
export interface AudioDeviceResult {
  success: boolean;
  devices?: AudioMicrophoneDevice[];
  currentDevice?: AudioMicrophoneDevice | null;
  message?: AudioBlockLocalizedMessage;
  errorName?: string;
  stream?: MediaStream;
}
export type AudioRuntimeState = Omit<
  AudioBlockState,
  keyof AudioContentState | 'microphoneDevice' | 'transcriptionText' | 'transcriptionError'
> & {
  microphoneDevice: AudioMicrophoneDevice | null;
  audioBlob: Blob | null;
  filename: string | null;
};
export interface AudioContentActions {
  loadContent(blockId: string): Promise<{ success: boolean; error?: string }>;
  persistDirtyContent(): Promise<{ success: boolean; error?: string }>;
  setNotesContentDraft(blockId: string, html: string): void;
  setTranscriptContentDraft(blockId: string, content: TranscriptDocument): void;
  setSummaryContentDraft(blockId: string, html: string): void;
  setTranslationState(
    blockId: string,
    changes: { language?: string | null; visible?: boolean; columnWidth?: number }
  ): void;
}
export interface AudioDeviceActions {
  getAvailableMicrophoneDevices(forceRefresh?: boolean): Promise<AudioDeviceResult>;
  requestMicrophonePermission(): Promise<AudioDeviceResult>;
}
/** 录音服务只使用这些能力，不接收整个 Pinia store。 */
export interface AudioRecordingPort {
  getRuntime(blockId: string): AudioRuntimeState;
  updateRuntime(blockId: string, updates: Partial<AudioRuntimeState>): void;
  startRecording(blockId: string): void;
  stopRecording(blockId: string): void;
  setAudioBlobUrl(blockId: string, url: string): void;
  loadAudioFile(blockId: string, filePath: string): Promise<boolean>;
  requestMicrophonePermission(): Promise<AudioDeviceResult>;
}
export interface AudioRuntimeActions
  extends Pick<
    AudioRecordingPort,
    'setAudioBlobUrl' | 'loadAudioFile' | 'requestMicrophonePermission'
  > {
  terminateAllRecordingsForSave(): Promise<boolean>;
  checkMicrophoneForBlock(
    blockId: string,
    forceRefresh?: boolean
  ): Promise<{ success: boolean; device?: AudioMicrophoneDevice; error?: string } | undefined>;
  resolveAudioForTranscription(
    blockId: string
  ): Promise<{ blob: Blob; mimeType: string; filename: string | undefined; duration: number }>;
  setAudioResourceUrl(blockId: string, url: string): void;
  setAudioDataUrl(blockId: string, url: string): void;
  cleanupBlock(blockId: string): void;
  recordingPort: AudioRecordingPort;
}
