import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import vm from 'node:vm';
import { extractArticle } from '../../extraction/extractArticle';
import {
  buildDomCaptureScript,
  buildReadinessSampleScript,
  buildScrollProbeScript,
  buildScrollStepScript,
} from './buildRenderCaptureScripts';
import {
  parseBrowserCapturePayload,
  parseBrowserReadinessSample,
  parseBrowserScrollProbe,
} from './parseRenderCaptureResult';

interface ComputedStyleSpec {
  readonly display?: string;
  readonly visibility?: string;
  readonly position?: string;
  readonly opacity?: string;
  readonly overflowY?: string;
}

function createDomSandbox(
  html: string,
  options: {
    readonly url?: string;
    readonly computedStyles?: WeakMap<Element, ComputedStyleSpec>;
    readonly setup?: (document: Document) => void;
  } = {},
): {
  readonly document: Document;
  readonly run: (script: string) => unknown;
} {
  const pageUrl = options.url ?? 'https://portal.example.test/news/index.html';
  const parsed = parseHTML(html);
  const { document, window } = parsed;
  Object.defineProperty(document, 'URL', { value: pageUrl, configurable: true });
  Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
  if (!document.implementation) {
    Object.defineProperty(document, 'implementation', {
      value: {
        createHTMLDocument: () => parseHTML('<!doctype html><html><head><title></title></head><body></body></html>').document,
      },
      configurable: true,
    });
  }
  options.setup?.(document);

  const getComputedStyle = (el: Element): ComputedStyleSpec => {
    const mapped = options.computedStyles?.get(el);
    if (mapped) return mapped;
    const raw = el.getAttribute('style') ?? '';
    let display = el.tagName === 'SPAN' || el.tagName === 'A' ? 'inline' : 'block';
    let visibility = 'visible';
    let position = 'static';
    let opacity = '1';
    for (const part of raw.split(';')) {
      const sep = part.indexOf(':');
      if (sep < 0) continue;
      const prop = part.slice(0, sep).trim().toLowerCase();
      const val = part.slice(sep + 1).trim().toLowerCase();
      if (prop === 'display') display = val;
      if (prop === 'visibility') visibility = val;
      if (prop === 'position') position = val;
      if (prop === 'opacity') opacity = val;
    }
    return { display, visibility, position, opacity, overflowY: 'visible' };
  };

  Object.defineProperty(window, 'getComputedStyle', {
    value: getComputedStyle,
    configurable: true,
  });

  const sandbox = {
    document,
    window,
    location: new URL(pageUrl),
    URL,
    Set,
    Event: parsed.Event ?? class {},
  };
  return {
    document,
    run: (script: string) => vm.runInNewContext(script, sandbox),
  };
}

describe('浏览器采集结果校验器', () => {
  it('校验并兼容缺少 mainTextLength 的旧版就绪采样', () => {
    expect(parseBrowserReadinessSample({ readyState: 'complete', textLength: 120, scriptCount: 2 })).toEqual({
      readyState: 'complete',
      textLength: 120,
      mainTextLength: 120,
      scriptCount: 2,
    });
    expect(parseBrowserReadinessSample({
      readyState: 'interactive',
      textLength: 500,
      mainTextLength: 40,
      scriptCount: 5,
    })).toEqual({
      readyState: 'interactive',
      textLength: 500,
      mainTextLength: 40,
      scriptCount: 5,
    });
    expect(parseBrowserReadinessSample('<html></html>')).toBeNull();
  });

  it('校验滚动探针与严格 DOM 采集结果（拒绝非法策略 URL 或错误类型）', () => {
    expect(parseBrowserScrollProbe({
      scrollY: 0,
      scrollHeight: 2400,
      viewportHeight: 900,
      mainTextLength: 1200,
      atBottom: false,
    })).toEqual({
      scrollY: 0,
      scrollHeight: 2400,
      viewportHeight: 900,
      mainTextLength: 1200,
      atBottom: false,
    });
    expect(parseBrowserScrollProbe({ scrollY: -1 })).toBeNull();

    const parsed = parseBrowserCapturePayload({
      html: '<html><body><p>ok</p></body></html>',
      warnings: ['inlined_same_origin_iframe', 'unknown_flag'],
      inlinedFrameResources: [
        { kind: 'source', url: 'https://portal.example.test/sub/a.html', label: '公告' },
        { kind: 'source', url: 'http://127.0.0.1/secret' },
      ],
      mainTextLength: 2,
    });
    expect(parsed).toEqual({
      html: '<html><body><p>ok</p></body></html>',
      warnings: ['inlined_same_origin_iframe'],
      inlinedFrameResources: [
        { kind: 'source', url: 'https://portal.example.test/sub/a.html', label: '公告' },
      ],
      mainTextLength: 2,
    });
    expect(parseBrowserCapturePayload({ html: 123 })).toBeNull();
    expect(parseBrowserCapturePayload({ html: '<p>ok</p>', accessBarrier: 'bogus' })).toBeNull();
  });
});

describe('浏览器采集脚本行为与严格四步顺序', () => {
  it('主区采样过滤导航/弹窗/固定栏；存在空 main 时不把 nav 当正文', () => {
    const dom = createDomSandbox(`
      <!doctype html><html><body>
        <nav>${'全局导航栏目链接 '.repeat(40)}</nav>
        <div role="dialog" id="cookie">${'Cookie 设置弹窗说明 '.repeat(25)}</div>
        <main id="content"></main>
      </body></html>
    `);
    const sample = parseBrowserReadinessSample(dom.run(buildReadinessSampleScript()));
    expect(sample).not.toBeNull();
    expect(sample!.textLength).toBeGreaterThan(400);
    expect(sample!.mainTextLength).toBe(0);
  });

  it('并列与嵌套主区只计一次，隐藏祖先和导航内的文章不计入', () => {
    const articles = Array.from({ length: 500 }, () => '<article><main>ABCD</main></article>').join('');
    const dom = createDomSandbox(`<html><body>${articles}<nav><article>菜单</article></nav>
      <div hidden><article>隐藏</article></div></body></html>`);
    let containsCalls = 0;
    for (const candidate of dom.document.querySelectorAll('article, main')) {
      const contains = candidate.contains.bind(candidate);
      candidate.contains = node => { containsCalls++; return contains(node); };
    }
    expect(parseBrowserReadinessSample(dom.run(buildReadinessSampleScript()))?.mainTextLength).toBe(2000);
    expect(containsCalls).toBeLessThan(2000);
  });

  it('第一步优先于剪枝：移除固定登录遮罩前先判定 login_required，不露出背后截断正文', () => {
    const styles = new WeakMap<Element, ComputedStyleSpec>();
    const dom = createDomSandbox(
      `<!doctype html><html><body>
        <article><h1>付费文章</h1><p>${'可公开预览的前三段截断占位说明。'.repeat(30)}</p></article>
        <div id="gate" role="dialog" aria-modal="true">
          <p>请先登录后查看完整正文</p>
          <input type="password" placeholder="密码">
        </div>
      </body></html>`,
      {
        computedStyles: styles,
        setup: (doc) => {
          const gate = doc.getElementById('gate');
          if (gate) styles.set(gate, { position: 'fixed', display: 'block', visibility: 'visible', opacity: '1' });
        },
      },
    );
    const payload = parseBrowserCapturePayload(dom.run(buildDomCaptureScript()));
    expect(payload).not.toBeNull();
    expect(payload!.accessBarrier).toBe('login_required');
    expect(payload!.html).toBe('');
  });

  it('第二步在计算样式剪枝前保护可展开折叠正文与 details，同时仍排除内部隐藏旧值，且保留 opacity: 0 与懒加载图', () => {
    const styles = new WeakMap<Element, ComputedStyleSpec>();
    const dom = createDomSandbox(
      `<!doctype html><html><body>
        <div id="cookie" role="dialog"><p>COOKIE_BANNER_NOISE</p></div>
        <main>
          <h1>可见结构正文</h1>
          <button id="btn-more" aria-expanded="false" aria-controls="more-box">展开阅读</button>
          <div id="more-box" class="collapsed-panel">
            <p>${'用户可主动展开的正文段落。'.repeat(25)}</p>
            <div hidden>INTERNAL HIDDEN OLD VALUE</div>
            <span id="css-stale">CSS STALE VALUE</span>
          </div>
          <details>
            <summary>补充说明</summary>
            <p>${'原生的 details 折叠补充正文。'.repeat(20)}</p>
          </details>
          <div id="fade-box" style="opacity: 0"><p>SCROLL FADE VISIBLE TEXT</p></div>
          <div id="inactive-tab"><p>INACTIVE TAB NOISE</p></div>
          <figure>
            <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="/images/chart.png" width="800" height="600" alt="图表">
            <figcaption>统计图注</figcaption>
          </figure>
        </main>
      </body></html>`,
      {
        computedStyles: styles,
        setup: (doc) => {
          const moreBox = doc.getElementById('more-box');
          if (moreBox) styles.set(moreBox, { display: 'none', visibility: 'visible', opacity: '1' });
          const stale = doc.getElementById('css-stale');
          if (stale) styles.set(stale, { display: 'none', visibility: 'visible', opacity: '1' });
          const tab = doc.getElementById('inactive-tab');
          if (tab) styles.set(tab, { display: 'none', visibility: 'visible', opacity: '1' });
          const cookie = doc.getElementById('cookie');
          if (cookie) styles.set(cookie, { position: 'fixed', display: 'block', visibility: 'visible', opacity: '1' });
        },
      },
    );
    const payload = parseBrowserCapturePayload(dom.run(buildDomCaptureScript()));
    expect(payload).not.toBeNull();
    expect(payload!.accessBarrier).toBeUndefined();
    const extracted = extractArticle(payload!.html, { url: 'https://portal.example.test/news/index.html' });
    expect(extracted.title).toBe('可见结构正文');
    expect(extracted.text).toContain('用户可主动展开的正文段落');
    expect(extracted.text).toContain('原生的 details 折叠补充正文');
    expect(extracted.text).toContain('SCROLL FADE VISIBLE TEXT');
    expect(extracted.text).not.toContain('INTERNAL HIDDEN OLD VALUE');
    expect(extracted.text).not.toContain('CSS STALE VALUE');
    expect(extracted.text).not.toContain('INACTIVE TAB NOISE');
    expect(extracted.text).not.toContain('COOKIE_BANNER_NOISE');
    expect(extracted.images[0]?.url).toBe('https://portal.example.test/images/chart.png');
  });

  it('第三步按 slot.assignedNodes({ flatten: true }) 展平开放 Shadow DOM 且不重复，并按子文档 URL 内联同源 iframe', () => {
    const shadowDom = createDomSandbox(
      `<!doctype html><html><head><title>Shadow组件文档</title></head><body>
        <article>
          <h1>Shadow 组件文章</h1>
          <x-card id="card">
            <p slot="lead">${'CARD SLOT ONCE '.repeat(12)}</p>
            <p slot="unused">UNASSIGNED LIGHT OMITTED</p>
          </x-card>
        </article>
      </body></html>`,
      {
        setup: (doc) => {
          const card = doc.getElementById('card');
          if (card) {
            const shadowFrag = parseHTML(`<!doctype html><html><body>
              <div class="shadow-inner">
                <h2>Shadow Title</h2>
                <slot name="lead"></slot>
              </div>
            </body></html>`).document.body;
            const slotEl = shadowFrag.querySelector('slot');
            const leadNode = card.querySelector('[slot="lead"]');
            if (slotEl && leadNode) {
              Object.defineProperty(slotEl, 'assignedNodes', {
                value: () => [leadNode],
              });
            }
            Object.defineProperty(card, 'shadowRoot', {
              value: { childNodes: shadowFrag.childNodes },
            });
          }
        },
      },
    );
    const shadowPayload = parseBrowserCapturePayload(shadowDom.run(buildDomCaptureScript()));
    expect(shadowPayload).not.toBeNull();
    const shadowExtracted = extractArticle(shadowPayload!.html, { url: 'https://portal.example.test/news/index.html' });
    expect(shadowExtracted.text.match(/CARD SLOT ONCE/g)).toHaveLength(12);
    expect(shadowExtracted.text).not.toContain('UNASSIGNED LIGHT OMITTED');

    const dom = createDomSandbox(
      `<!doctype html><html><head><title>政务发布</title></head><body>
        <main>
          <h1>公告主壳</h1>
          <iframe id="same-frame" src="/sub/bulletin.html" title="公文正文框"></iframe>
          <iframe id="cross-frame" src="https://docs.example.test/archive/list.html" title="跨源附件目录"></iframe>
        </main>
      </body></html>`,
      {
        setup: (doc) => {
          const sameFrame = doc.getElementById('same-frame');
          if (sameFrame) {
            const childDoc = parseHTML(`
              <!doctype html><html><body>
                <article>
                  <h2>关于加快项目审批的通知</h2>
                  <p>文号：国办发〔2026〕12号。${'同源内联正文内容详情。'.repeat(20)}</p>
                  <table><tr><th>指标</th><th>数值</th></tr><tr><td>拨款</td><td>580</td></tr></table>
                  <a href="../files/attach.pdf">下载正式附件</a>
                </article>
              </body></html>
            `).document;
            Object.defineProperty(childDoc, 'URL', {
              value: 'https://portal.example.test/sub/bulletin.html',
            });
            Object.defineProperty(sameFrame, 'contentDocument', { value: childDoc });
          }

          const crossFrame = doc.getElementById('cross-frame');
          if (crossFrame) {
            Object.defineProperty(crossFrame, 'contentDocument', { value: null });
          }
        },
      },
    );

    const payload = parseBrowserCapturePayload(dom.run(buildDomCaptureScript()));
    expect(payload).not.toBeNull();
    expect(payload!.warnings).toContain('inlined_same_origin_iframe');
    expect(payload!.inlinedFrameResources).toEqual([
      { kind: 'source', url: 'https://portal.example.test/sub/bulletin.html', label: '公文正文框' },
    ]);

    const extracted = extractArticle(payload!.html, { url: 'https://portal.example.test/news/index.html' });
    expect(extracted.title).toBe('政务发布');
    expect(extracted.text).toContain('国办发〔2026〕12号');
    expect(extracted.text).toContain('580');
    expect(extracted.text).toContain('https://portal.example.test/files/attach.pdf');
    expect(extracted.resources.some((r) => r.url === 'https://portal.example.test/files/attach.pdf' && r.kind === 'document')).toBe(true);
    expect(extracted.resources.some((r) => r.url === 'https://docs.example.test/archive/list.html' && r.kind === 'source')).toBe(true);
  });

  it('sticky 的表头、固定列和吸顶小标题属于正文；sticky 导航条仍被剪掉', () => {
    const styles = new WeakMap<Element, ComputedStyleSpec>();
    const sticky: ComputedStyleSpec = { position: 'sticky', display: 'block', visibility: 'visible', opacity: '1' };
    const dom = createDomSandbox(
      `<!doctype html><html><body>
        <div id="topbar">吸顶站点导航条文字</div>
        <div id="content">
          <h2 id="section">吸顶小标题第三季度</h2>
          <table>
            <thead><tr><th id="head">固定表头项目名称</th><th>金额</th></tr></thead>
            <tbody><tr><td id="pinned">固定首列营业收入</td><td>${'1,234.56 '.repeat(60)}</td></tr></tbody>
          </table>
        </div>
      </body></html>`,
      {
        computedStyles: styles,
        setup: (doc) => {
          for (const id of ['topbar', 'section', 'head', 'pinned']) {
            const el = doc.getElementById(id);
            if (el) styles.set(el, sticky);
          }
        },
      },
    );
    const payload = parseBrowserCapturePayload(dom.run(buildDomCaptureScript()));
    expect(payload).not.toBeNull();
    expect(payload!.accessBarrier).toBeUndefined();
    expect(payload!.html).toContain('固定表头项目名称');
    expect(payload!.html).toContain('固定首列营业收入');
    expect(payload!.html).toContain('吸顶小标题第三季度');
    expect(payload!.html).not.toContain('吸顶站点导航条文字');
  });

  it('reCAPTCHA v3 角标不算验证码拦截；正文充足时页面内嵌的登录框也不算登录墙', () => {
    const dom = createDomSandbox(
      `<!doctype html><html><body>
        <main><h1>公开文章</h1><p>${'这是一段任何人都能读到的公开正文内容。'.repeat(40)}</p>
          <form id="inline-login"><input type="password" placeholder="密码"></form>
        </main>
        <div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=x"></iframe></div>
      </body></html>`,
    );
    const payload = parseBrowserCapturePayload(dom.run(buildDomCaptureScript()));
    expect(payload).not.toBeNull();
    expect(payload!.accessBarrier).toBeUndefined();
    expect(payload!.html).toContain('这是一段任何人都能读到的公开正文内容');
  });

  it('正文不足时，验证码与密码框仍判为访问屏障', () => {
    const captcha = createDomSandbox(
      `<!doctype html><html><body><main><p>请完成验证</p>
        <iframe src="https://www.google.com/recaptcha/api2/anchor?k=x" width="300" height="80"></iframe>
      </main></body></html>`,
    );
    expect(parseBrowserCapturePayload(captcha.run(buildDomCaptureScript()))!.accessBarrier).toBe('captcha');
    const login = createDomSandbox(
      `<!doctype html><html><body><main><p>登录后继续</p><input type="password"></main></body></html>`,
    );
    expect(parseBrowserCapturePayload(login.run(buildDomCaptureScript()))!.accessBarrier).toBe('login_required');
  });

  it('内联 SVG 的图形文字不进正文；嵌套超过上限时截断并给出 capture_truncated', () => {
    const svg = createDomSandbox(
      `<!doctype html><html><body><main><p>${'图表旁边的说明正文。'.repeat(30)}</p>
        <svg viewBox="0 0 10 10"><text>图表坐标轴刻度文字</text></svg>
      </main></body></html>`,
    );
    const svgPayload = parseBrowserCapturePayload(svg.run(buildDomCaptureScript()));
    expect(svgPayload!.html).toContain('图表旁边的说明正文');
    expect(svgPayload!.html).not.toContain('图表坐标轴刻度文字');
    expect(svgPayload!.warnings).not.toContain('capture_truncated');

    const deep = createDomSandbox(
      `<!doctype html><html><body><main><p>${'嵌套层之前的正文。'.repeat(30)}</p>${'<div>'.repeat(300)}最深处的文字${'</div>'.repeat(300)}</main></body></html>`,
    );
    const deepPayload = parseBrowserCapturePayload(deep.run(buildDomCaptureScript()));
    expect(deepPayload!.html).toContain('嵌套层之前的正文');
    expect(deepPayload!.html).not.toContain('最深处的文字');
    expect(deepPayload!.warnings).toContain('capture_truncated');
  });

  it('滚动探针与步进脚本返回合法有界快照', () => {
    const dom = createDomSandbox('<!doctype html><html><body><main><p>Scrollable content</p></main></body></html>');
    const probe = parseBrowserScrollProbe(dom.run(buildScrollProbeScript()));
    const stepped = parseBrowserScrollProbe(dom.run(buildScrollStepScript({ stepMultiplier: 1 })));
    expect(probe).not.toBeNull();
    expect(stepped).not.toBeNull();
    expect(probe!.mainTextLength).toBeGreaterThan(0);
  });
});
