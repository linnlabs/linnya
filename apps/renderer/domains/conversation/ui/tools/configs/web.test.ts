import { describe, expect, it } from 'vitest';
import { webToolConfigs } from './web';

describe('webToolConfigs', () => {
  it('web_search 由 presentation projector 唯一解释 payload 与标题', () => {
    const config = webToolConfigs['web_search'];
    expect(config && 'presentation' in config ? config.presentation : undefined).toBeTypeOf('function');
  });

  it('web_read 按结果分流到网页卡或下载图片，两者都由 presentation projector 解释 payload', () => {
    const page = webToolConfigs['web_read_page'];
    const image = webToolConfigs['web_read_image'];
    expect(page && 'presentation' in page ? page.presentation : undefined).toBeTypeOf('function');
    expect(image && 'presentation' in image ? image.presentation : undefined).toBeTypeOf('function');
    expect(webToolConfigs['web_read']).toHaveProperty('resolveUiKey');
  });
});
