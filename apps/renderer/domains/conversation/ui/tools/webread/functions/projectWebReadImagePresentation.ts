import { WebReadArgsSchema, WebReadResultSchema } from '@app/schemas';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import type { WebReadImagePresentationData } from '../definitions/webReadImagePresentation';
import { WEB_READ_IMAGE_UI_KEY } from './resolveWebReadUiKey';

function displayHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

/**
 * 下载的图片直接显示在对话里，下面一行写来源、尺寸与许可（或署名、网页版权声明）。
 * 标题只在失败时给出，供宿主画成一行错误；成功态只接纳 web_read 的正式结果合同。
 */
export function projectWebReadImagePresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<WebReadImagePresentationData> {
  if (input.uiKey !== WEB_READ_IMAGE_UI_KEY || input.sourceToolName !== 'web_read') {
    throw new Error(`Unsupported Web image presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`);
  }
  if (input.status !== 'success') {
    return {
      data: { kind: 'lifecycle' },
      ...(input.status === 'error'
        ? { title: createConversationToolTitleDescriptor('conversation.tool.webReadImage.failed') }
        : {}),
    };
  }
  WebReadArgsSchema.parse(input.args);
  const result = WebReadResultSchema.parse(input.result);
  const image = result.data.image;
  if (!image) throw new Error('Web image presentation requires an acquired image.');
  const source = image.source;
  const sourceUrl = source?.page_url ?? result.data.url;
  const license = source?.license;
  return {
    data: {
      kind: 'image',
      ...(result.media
        ? { media: { path: result.media.path, mediaType: result.media.media_type, width: result.media.width, height: result.media.height } }
        : {}),
      width: image.width,
      height: image.height,
      sourceUrl,
      sourceHost: displayHost(sourceUrl),
      ...(license
        ? {
            license: {
              code: license.code,
              name: license.name,
              commercialUse: license.commercial_use,
              modifications: license.modifications,
              attributionRequired: license.attribution_required,
            },
          }
        : {}),
      ...(source?.credit ? { credit: source.credit } : {}),
      ...(source?.page_rights ? { pageRights: source.page_rights } : {}),
    },
  };
}
