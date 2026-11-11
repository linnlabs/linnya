import { WebReadArgsSchema, WebReadResultSchema } from '@app/schemas';

export const WEB_READ_PAGE_UI_KEY = 'web_read_page';
export const WEB_READ_IMAGE_UI_KEY = 'web_read_image';

const IMAGE_PATH = /\.(?:jpe?g|png|webp)$/i;

/**
 * 成功结果按正式 schema 分流：带图片事实的是下载图片，其余是网页与文件卡。
 * 结果到达前（进行中、失败）只有请求地址：路径以图片扩展名结尾时按下载图片显示“正在下载图片…”与单行错误。
 * 这只决定运行中的样子；成功后仍以结果为准，图片扩展名的地址返回网页时回到网页卡。
 */
export function resolveWebReadUiKey(args: unknown, result?: unknown): string {
  const live = WebReadResultSchema.safeParse(result);
  if (live.success) return live.data.data.image ? WEB_READ_IMAGE_UI_KEY : WEB_READ_PAGE_UI_KEY;
  const parsedArgs = WebReadArgsSchema.safeParse(args);
  if (!parsedArgs.success) return WEB_READ_PAGE_UI_KEY;
  return IMAGE_PATH.test(new URL(parsedArgs.data.url).pathname) ? WEB_READ_IMAGE_UI_KEY : WEB_READ_PAGE_UI_KEY;
}
