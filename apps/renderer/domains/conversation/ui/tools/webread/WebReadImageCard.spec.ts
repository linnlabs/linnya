// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, defineComponent, h, provide } from 'vue';
import { TOOL_EXECUTION_SCOPE_KEY } from '../../../shared/execution-presentation/definitions/executionActivity';
import { executionActivity } from '../../../shared/execution-presentation/functions/resolveExecutionActivity';
import type { ToolCardPresentation } from '../types';
import type { WebReadImagePresentationData } from './definitions/webReadImagePresentation';
import WebReadImageCard from './WebReadImageCard.vue';

vi.mock('../../useConversationLocalization', () => ({
  useConversationLocalization: () => ({
    conversationMessage: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}${JSON.stringify(params)}` : key,
  }),
}));

let mountedApp: ReturnType<typeof createApp> | undefined;
let mountPoint: HTMLDivElement | undefined;

afterEach(() => {
  mountedApp?.unmount();
  mountPoint?.remove();
  mountedApp = undefined;
  mountPoint = undefined;
});

function mount(presentation: ToolCardPresentation<WebReadImagePresentationData>): HTMLDivElement {
  (window as unknown as { linnyaMedia: unknown }).linnyaMedia = {
    getFileName: (value: string) => value.split('/').pop() ?? '',
    buildGeneratedImageUrl: (value: string) => `media://load/generated-image/${value}`,
  };
  const Host = defineComponent({
    setup() {
      provide(TOOL_EXECUTION_SCOPE_KEY, {
        activity: computed(() => executionActivity(presentation.status === 'loading' ? 'running' : 'completed')),
        headerOwnsProgress: computed(() => false),
      });
      return () => h(WebReadImageCard, { presentation });
    },
  });
  mountPoint = document.createElement('div');
  document.body.appendChild(mountPoint);
  mountedApp = createApp(Host);
  mountedApp.mount(mountPoint);
  return mountPoint;
}

describe('WebReadImageCard', () => {
  it('下载中只显示一行“正在下载图片”，不占图片大小的位置，不套卡片', () => {
    const root = mount({ uiKey: 'web_read_image', status: 'loading', phase: 'start', data: { kind: 'lifecycle' } });
    expect(root.querySelector('.tool-inline-line')?.textContent).toContain('conversation.tool.webReadImage.loading');
    expect(root.querySelector('.image-placeholder')).toBeNull();
    expect(root.querySelector('.tool-card')).toBeNull();
  });

  it('下载完成直接显示图片，下面一行写来源、尺寸与许可要点', () => {
    const root = mount({
      uiKey: 'web_read_image',
      status: 'success',
      phase: 'complete',
      data: {
        kind: 'image',
        media: { path: '/data/web-downloads/a.jpg', mediaType: 'image/jpeg', width: 1200, height: 900 },
        width: 1200,
        height: 900,
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
        sourceHost: 'commons.wikimedia.org',
        license: { code: 'by-sa', name: 'CC BY-SA 4.0', commercialUse: true, modifications: true, attributionRequired: true },
      },
    });
    expect(root.querySelector('img')?.getAttribute('src')).toBe('media://load/generated-image//data/web-downloads/a.jpg');
    const source = root.querySelector('.web-read-image__source')?.textContent ?? '';
    expect(source).toContain('commons.wikimedia.org');
    expect(source).toContain('1200 × 900');
    expect(source).toContain('CC BY-SA 4.0');
    expect(source).toContain('conversation.tool.webReadImage.commercial');
    expect(source).toContain('conversation.tool.webReadImage.shareAlike');
  });

  it('没有许可记录时给出网页版权声明；都没有时提示引用前看来源网页', () => {
    const base = {
      kind: 'image' as const, width: 800, height: 600,
      sourceUrl: 'https://www.catl.com/news/1.html', sourceHost: 'catl.com',
    };
    const withRights = mount({
      uiKey: 'web_read_image', status: 'success', phase: 'complete', data: { ...base, pageRights: '© CATL' },
    });
    expect(withRights.textContent).toContain('conversation.tool.webReadImage.pageRights{"text":"© CATL"}');
    mountedApp?.unmount();
    mountPoint?.remove();
    const bare = mount({ uiKey: 'web_read_image', status: 'success', phase: 'complete', data: base });
    expect(bare.textContent).toContain('conversation.tool.webReadImage.noLicense');
    // 旧回执没有本机路径：一行“下载了图片”代替图片。
    expect(bare.textContent).toContain('conversation.tool.webReadImage.downloaded');
  });
});
