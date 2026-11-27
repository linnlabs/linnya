import { READABLE_DOM_SCRIPT } from './readableDomScript';

/** 浏览器端就绪采样脚本：同时返回 body 可见字数与排除外围噪音/固定遮罩后的主区可见字数。 */
export function buildReadinessSampleScript(): string {
  return `(() => {
${READABLE_DOM_SCRIPT}
  var body = document.body;
  var totalText = body ? (body.innerText || body.textContent || '') : '';
  return {
    readyState: document.readyState,
    textLength: normLen(totalText),
    mainTextLength: measureDocMainText(document, 0),
    scriptCount: document.scripts ? document.scripts.length : 0,
  };
})()`;
}

const SCROLL_HELPER_SCRIPT = `
  function findScrollTarget() {
    var root = document.scrollingElement || document.documentElement || document.body;
    var winViewport = Math.max(1, window.innerHeight || (root && root.clientHeight) || 900);
    var rootHeight = root ? (root.scrollHeight || 0) : 0;
    if (rootHeight > winViewport + 24) {
      return {
        isWindow: true,
        element: root,
        scrollY: Math.max(0, Math.round(window.scrollY || (root ? root.scrollTop : 0) || 0)),
        scrollHeight: rootHeight,
        viewportHeight: winViewport,
      };
    }
    var candidates = document.querySelectorAll
      ? document.querySelectorAll(MAIN_SELECTOR + ', body > div, body > section')
      : [];
    for (var i = 0; i < candidates.length; i += 1) {
      var el = candidates[i];
      if (!el || el.clientHeight <= 0 || el.scrollHeight <= el.clientHeight + 24) continue;
      var st = safeStyle(el);
      var ov = st ? st.overflowY : '';
      if (ov === 'auto' || ov === 'scroll' || ov === 'overlay') {
        return {
          isWindow: false,
          element: el,
          scrollY: Math.max(0, Math.round(el.scrollTop || 0)),
          scrollHeight: el.scrollHeight,
          viewportHeight: Math.max(1, el.clientHeight),
        };
      }
    }
    return {
      isWindow: true,
      element: root,
      scrollY: Math.max(0, Math.round(window.scrollY || (root ? root.scrollTop : 0) || 0)),
      scrollHeight: Math.max(winViewport, rootHeight),
      viewportHeight: winViewport,
    };
  }

  function readScrollProbe() {
    var target = findScrollTarget();
    var atBottom = target.scrollY + target.viewportHeight >= target.scrollHeight - 24;
    var scope = target.isWindow ? (document.querySelector('main, [role="main"], article') || document.body) : target.element;
    var row = target.scrollHeight > target.viewportHeight && (scope.querySelector('tbody tr, [role="row"]:has([role="gridcell"], [role="cell"]), li, [role="listitem"]')
      || scope.querySelector('p') || scope.firstElementChild);
    var firstRow = row && !isElementInChrome(row, document) && !isElementSelfHidden(row)
      ? ((row.getAttribute('aria-rowindex') || '') + ' ' + (row.innerText || '').trim()).trim().slice(0, 192)
      : '';
    return {
      firstRow: firstRow,
      scrollY: target.scrollY,
      scrollHeight: target.scrollHeight,
      viewportHeight: target.viewportHeight,
      mainTextLength: measureDocMainText(document, 0),
      atBottom: atBottom,
    };
  }
`;

/** 浏览器端滚动探针脚本：在未产生副作用前探测是否需要增量滚动。 */
export function buildScrollProbeScript(): string {
  return `(() => {
${READABLE_DOM_SCRIPT}
${SCROLL_HELPER_SCRIPT}
  return readScrollProbe();
})()`;
}

/** 浏览器端单步轻量滚动脚本：向下推进约一屏，用于触发 append-only 懒加载正文。 */
export function buildScrollStepScript(options: { readonly stepMultiplier?: number; readonly scrollToY?: number } = {}): string {
  const multiplier = typeof options.stepMultiplier === 'number' && Number.isFinite(options.stepMultiplier) && options.stepMultiplier > 0
    ? options.stepMultiplier
    : 1;
  const destination = options.scrollToY === undefined ? 'target.scrollY + delta' : String(Math.max(0, Math.round(options.scrollToY)));
  return `(() => {
${READABLE_DOM_SCRIPT}
${SCROLL_HELPER_SCRIPT}
  var target = findScrollTarget();
  var maxScroll = Math.max(0, target.scrollHeight - target.viewportHeight);
  var delta = Math.max(100, Math.round(target.viewportHeight * ${multiplier}));
  var nextY = Math.min(maxScroll, ${destination});
  if (target.isWindow && typeof window.scrollTo === 'function') {
    window.scrollTo(0, nextY);
    if (target.element && target.element.scrollTop !== nextY) target.element.scrollTop = nextY;
  } else if (target.element) {
    target.element.scrollTop = nextY;
    try {
      target.element.dispatchEvent(new Event('scroll'));
    } catch (_) {}
  }
  return readScrollProbe();
})()`;
}
