import { describe, expect, it } from 'vitest';
import { resolveDesktopBackendConfiguration } from './resolveDesktopBackendConfiguration';

describe('Desktop Backend 启动配置', () => {
  it('开发使用动态端口，显式 API 端口与独立存储的 Vite E2E 仍可使用', () => {
    expect(resolveDesktopBackendConfiguration({
      packaged: false, developmentMode: true, rendererUrl: 'http://127.0.0.1:49200/',
    })).toEqual({
      qdrant: { host: '127.0.0.1', port: 0 },
      server: { port: 0, rendererOrigin: 'http://127.0.0.1:49200' },
    });
    expect(resolveDesktopBackendConfiguration({
      packaged: false, developmentMode: false, rendererUrl: 'http://127.0.0.1:49201',
      configuredApiPort: '35000',
    }).server).toEqual({ port: 35000, rendererOrigin: 'http://127.0.0.1:49201' });
  });

  it('发布包不被开发开关或 Vite URL 改变端口及页面来源', () => {
    expect(resolveDesktopBackendConfiguration({
      packaged: true, developmentMode: true, rendererUrl: 'http://127.0.0.1:49200',
    })).toEqual({ qdrant: { host: '127.0.0.1', port: 6333 }, server: { port: 3000 } });
  });
});
