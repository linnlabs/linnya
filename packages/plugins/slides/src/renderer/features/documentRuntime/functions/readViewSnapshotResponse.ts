import { SLIDES_VIEW_FORMAT_VERSION, ViewReadResponseSchema, type ViewReadResponse } from '@plugin/slides/shared/presentationViewSnapshot';

/** 开发前端可热更新而 Backend 不会随之重启；协议不兼容时不安装旧数据或伪造新版。 */
export function readViewSnapshotResponse(value: unknown): ViewReadResponse {
  if (value !== null && typeof value === 'object' && 'formatVersion' in value
    && typeof value.formatVersion === 'number' && value.formatVersion !== SLIDES_VIEW_FORMAT_VERSION) {
    throw new Error('Slides 预览与后台版本不一致。请完全退出当前开发实例并重新启动，再打开文稿。');
  }
  return ViewReadResponseSchema.parse(value);
}
