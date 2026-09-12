export type ImageInputApiSurface =
  | 'openai_chat_completions'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'ollama_chat';

export interface ImageInputDimensions {
  readonly width: number;
  readonly height: number;
}

export interface ImageInputRouteLimits {
  readonly maxImages: number;
  readonly maxImageBytes: number;
  readonly maxTotalImageBytes: number;
  /** 厂商按整次请求图片数量收紧每边尺寸；未声明时不额外限制 Workspace 已核验的尺寸。 */
  readonly maxImageEdgePixels?: (imageCount: number) => number;
}

interface ImageInputProcessingProfileBase {
  readonly id: string;
  readonly transport: 'inline';
  readonly estimatorVersion: string;
  readonly estimateTokens: (dimensions: ImageInputDimensions) => number;
  readonly limits: ImageInputRouteLimits;
}

type OpenAiImageDetail = 'auto' | 'low' | 'high';

export type ImageInputProcessingProfile =
  | (ImageInputProcessingProfileBase & {
      readonly apiSurface: 'openai_chat_completions';
      readonly detail: OpenAiImageDetail;
    })
  | (ImageInputProcessingProfileBase & {
      readonly apiSurface: 'openai_responses';
      readonly detail: OpenAiImageDetail;
    })
  | (ImageInputProcessingProfileBase & {
      readonly apiSurface: 'anthropic_messages';
    })
  | (ImageInputProcessingProfileBase & {
      readonly apiSurface: 'ollama_chat';
    });
