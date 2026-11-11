import { ImageSearchArgsSchema, ImageSearchResultSchema, type ImageLicenseCode } from '@app/schemas';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';

/** 结果小图条最多放这么多张，其余只计数。 */
export const IMAGE_SEARCH_STRIP_MAX = 8;

export interface ImageSearchThumbnail {
  readonly thumbnailUrl: string;
  /**
   * 点开看大图用的地址。远程图片要按 CORS 方式加载：Commons 的下载地址（1920 档）带跨域头；
   * Openverse 的原图在各收藏方站点、多数不带，只用它自己的缩略图接口。
   */
  readonly previewUrl: string;
  readonly title: string;
  readonly provider: string;
  readonly licenseCode: ImageLicenseCode;
  readonly licenseName: string;
}

export interface ImageSearchPresentationData {
  readonly query: string;
  readonly candidateCount?: number;
  readonly thumbnails: readonly ImageSearchThumbnail[];
}

/**
 * 图片搜索不套卡片：组件自己画一行（查询词与张数）和结果小图条。
 * 标题只在失败时给出，供宿主画成一行错误；成功态只接纳 owner 的正式参数与结果合同。
 */
export function projectImageSearchPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<ImageSearchPresentationData> {
  if (input.sourceToolName !== 'image_search' || input.uiKey !== 'image_search') {
    throw new Error(`Unsupported image search presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`);
  }
  if (input.status !== 'success') {
    const args = ImageSearchArgsSchema.partial().safeParse(input.args);
    const query = (args.success ? args.data.query?.trim() : undefined) || '...';
    return {
      data: { query, thumbnails: [] },
      ...(input.status === 'error'
        ? { title: createConversationToolTitleDescriptor('conversation.tool.imageSearch.failed', { query }) }
        : {}),
    };
  }
  const args = ImageSearchArgsSchema.parse(input.args);
  const result = ImageSearchResultSchema.parse(input.result);
  if (result.data.query !== args.query) {
    throw new Error('Image search result query does not match request');
  }
  const thumbnails = result.data.candidates.flatMap(candidate => candidate.thumbnail_url
    ? [{
        thumbnailUrl: candidate.thumbnail_url,
        previewUrl: candidate.source === 'wikimedia_commons' ? candidate.download_url : candidate.thumbnail_url,
        title: candidate.title,
        provider: candidate.provider,
        licenseCode: candidate.license.code,
        licenseName: candidate.license.name,
      }]
    : []);
  return {
    data: {
      query: args.query,
      candidateCount: result.data.candidates.length,
      thumbnails: thumbnails.slice(0, IMAGE_SEARCH_STRIP_MAX),
    },
  };
}
