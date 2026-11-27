import { describe, expect, it } from 'vitest';
import { hasSpaHashRouteUrl, normalizeCitationWebUrl } from '../normalizeCitationWebUrl';

describe('normalizeCitationWebUrl 与 SPA hash 路由规则', () => {
  it('普通页内锚点与追踪参数仍归一为原网页身份', () => {
    const base = 'https://example.com/article';
    expect(normalizeCitationWebUrl('https://example.com/article/#section-1')).toBe(base);
    expect(normalizeCitationWebUrl('https://example.com/article#目录')).toBe(base);
    expect(normalizeCitationWebUrl('https://example.com/article#:~:text=highlight')).toBe(base);
    expect(normalizeCitationWebUrl('https://example.com/article#')).toBe(base);
    expect(normalizeCitationWebUrl('https://example.com/article/?utm_source=x#top')).toBe(base);
    expect(normalizeCitationWebUrl('https://example.com/app/#/')).toBe('https://example.com/app');
    expect(normalizeCitationWebUrl('https://example.com/app/#!/')).toBe('https://example.com/app');
  });

  it('保留 #/ 与 #!/ 形式的 SPA 路由片段，区分不同页面', () => {
    const a = normalizeCitationWebUrl('https://gov.example.test/#/notice/a');
    const b = normalizeCitationWebUrl('https://gov.example.test/#/notice/b');
    expect(a).toBe('https://gov.example.test/#/notice/a');
    expect(b).toBe('https://gov.example.test/#/notice/b');
    expect(a).not.toBe(b);

    const h1 = normalizeCitationWebUrl('https://gov.example.test/portal#!/items/1');
    const h2 = normalizeCitationWebUrl('https://gov.example.test/portal#!/items/2');
    expect(h1).toBe('https://gov.example.test/portal#!/items/1');
    expect(h2).toBe('https://gov.example.test/portal#!/items/2');
    expect(h1).not.toBe(h2);
  });

  it('规范化 SPA hash 路由中的末尾斜杠、二级子锚点与追踪查询参数', () => {
    expect(normalizeCitationWebUrl('https://gov.example.test/#/notice/a/')).toBe(
      'https://gov.example.test/#/notice/a',
    );
    expect(normalizeCitationWebUrl('https://docs.example.test/#/guide/intro#install')).toBe(
      'https://docs.example.test/#/guide/intro',
    );
    expect(
      normalizeCitationWebUrl('https://gov.example.test/#/notice?id=123&utm_source=newsletter'),
    ).toBe('https://gov.example.test/#/notice?id=123');
    expect(
      normalizeCitationWebUrl('https://gov.example.test/#/?tab=policy&utm_campaign=fall'),
    ).toBe('https://gov.example.test/#/?tab=policy');
  });

  it('hasSpaHashRouteUrl 准确区分非空 SPA 路由与普通锚点', () => {
    expect(hasSpaHashRouteUrl('https://gov.example.test/#/notice/a')).toBe(true);
    expect(hasSpaHashRouteUrl('https://gov.example.test/#!/items/1')).toBe(true);
    expect(hasSpaHashRouteUrl('https://gov.example.test/#/?tab=1')).toBe(true);
    expect(hasSpaHashRouteUrl('https://example.com/article#section-1')).toBe(false);
    expect(hasSpaHashRouteUrl('https://example.com/app/#/')).toBe(false);
    expect(hasSpaHashRouteUrl('https://example.com/app/#!/')).toBe(false);
    expect(hasSpaHashRouteUrl('not a valid url')).toBe(false);
  });
});
