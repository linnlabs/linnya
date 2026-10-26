import { describe, expect, it } from 'vitest';
import type { WebPageRenderer } from '../webread/definitions/webPageRenderer';
import {
  getWebPageRenderer,
  installWebPageRenderer,
} from '../webread/ports/webPageRenderer';

describe('WebPageRenderer port', () => {
  it('未安装时明确失败；安装和卸载只影响当前 adapter', async () => {
    await expect(getWebPageRenderer().render({ url: 'https://example.com' })).rejects.toEqual(
      expect.objectContaining({ kind: 'unavailable' }),
    );
    const renderer: WebPageRenderer = {
      render: async ({ url }) => ({
        html: '<html>fixture</html>',
        finalUrl: url,
        mainResponse: { status: 200, headers: {} },
      }),
    };
    const uninstall = installWebPageRenderer(renderer);
    await expect(getWebPageRenderer().render({ url: 'https://example.com' })).resolves.toEqual({
      html: '<html>fixture</html>',
      finalUrl: 'https://example.com',
      mainResponse: { status: 200, headers: {} },
    });
    uninstall();
    await expect(getWebPageRenderer().render({ url: 'https://example.com' })).rejects.toEqual(
      expect.objectContaining({ kind: 'unavailable' }),
    );
  });
});
