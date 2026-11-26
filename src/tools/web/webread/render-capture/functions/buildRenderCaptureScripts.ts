import {
  READABLE_CONTROL_SELECTOR,
  READABLE_HIDDEN_SELECTOR,
  READABLE_MAIN_SELECTOR,
  RENDER_IGNORED_IFRAME_URL_PATTERN_SOURCE,
} from '../definitions/renderCaptureContract';

const SHARED_DOM_HELPERS = `
  var MAIN_SELECTOR = ${JSON.stringify(READABLE_MAIN_SELECTOR)};
  var HIDDEN_ATTR_SELECTOR = ${JSON.stringify(READABLE_HIDDEN_SELECTOR)};
  var CONTROL_SELECTOR = ${JSON.stringify(READABLE_CONTROL_SELECTOR)};
  var IGNORED_IFRAME_RE = new RegExp(${JSON.stringify(RENDER_IGNORED_IFRAME_URL_PATTERN_SOURCE)}, 'i');
  // HTML 文档里 svg 元素的 tagName 是小写（外来命名空间不转大写），两种写法都要列。
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, svg: 1, OBJECT: 1, EMBED: 1 };
  var TABLE_CONTAINER_SELECTOR = 'table, [role="table"], [role="grid"], [role="treegrid"]';
  var STICKY_CONTENT_SELECTOR = 'th, td, tr, thead, tbody, tfoot, caption, h1, h2, h3, h4, h5, h6, [role="columnheader"], [role="rowheader"], [role="cell"], [role="gridcell"], [role="row"]';
  var CHROME_CONTAINER_SELECTOR = 'nav, footer, aside, [role="navigation"], [role="complementary"], [role="contentinfo"], [role="dialog"], [role="alertdialog"], [aria-modal="true"], [inert]';

  function normLen(text) {
    return typeof text === 'string' ? text.replace(/\\s+/g, ' ').trim().length : 0;
  }

  function safeStyle(el) {
    try {
      return typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
        ? window.getComputedStyle(el)
        : null;
    } catch (_) {
      return null;
    }
  }

  function hasHiddenInlineStyle(el) {
    var raw = el && el.getAttribute ? el.getAttribute('style') : '';
    if (!raw) return false;
    var parts = raw.split(';');
    for (var i = 0; i < parts.length; i += 1) {
      var decl = parts[i];
      var sep = decl.indexOf(':');
      if (sep < 0) continue;
      var prop = decl.slice(0, sep).trim().toLowerCase();
      var val = decl.slice(sep + 1).trim().toLowerCase().replace(/\\s*!important$/, '');
      if ((prop === 'display' && val === 'none')
        || (prop === 'visibility' && (val === 'hidden' || val === 'collapse'))) {
        return true;
      }
    }
    return false;
  }

  function isElementSelfHidden(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches && el.matches(HIDDEN_ATTR_SELECTOR + ', [inert], input[type="hidden" i]')) return true;
    if (hasHiddenInlineStyle(el)) return true;
    var st = safeStyle(el);
    if (!st) return false;
    return st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse';
  }

  var docTextLengthCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function docTextLength(doc) {
    if (docTextLengthCache && docTextLengthCache.has(doc)) return docTextLengthCache.get(doc);
    var len = doc && doc.body ? normLen(doc.body.textContent) : 0;
    if (docTextLengthCache) docTextLengthCache.set(doc, len);
    return len;
  }

  // 单页应用常把整个界面放进一个 fixed/sticky 的满屏容器；它承载页面多数文字，是正文而不是浮层。
  // 同时要求占满大半个视口，Cookie 条、角落提示卡这类窄条即使页面正文还没渲染出来也不会被当成正文。
  function isPositionedAppContainer(el, doc) {
    if (!el.getBoundingClientRect) return false;
    var win = doc.defaultView;
    var vw = win ? win.innerWidth : 0;
    var vh = win ? win.innerHeight : 0;
    if (!(vw > 0 && vh > 0)) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < vw * 0.6 || rect.height < vh * 0.6) return false;
    var ownLen = normLen(el.textContent);
    return ownLen >= 200 && ownLen * 2 >= docTextLength(doc);
  }

  /**
   * fixed/sticky 元素是否属于页面外围浮层（导航条、Cookie 条、遮罩）。
   * sticky 仍在文档流里：固定表头、固定列和吸顶小标题是正文，删掉会让表格缺列缺表头且没有任何提示。
   */
  function isFloatingChrome(el, doc) {
    var st = safeStyle(el);
    if (!st || (st.position !== 'fixed' && st.position !== 'sticky')) return false;
    if (el === doc.documentElement || el === doc.body) return false;
    if (el.matches && el.matches(MAIN_SELECTOR)) return false;
    if (el.querySelector && el.querySelector(MAIN_SELECTOR)) return false;
    if (st.position === 'sticky') {
      if (el.matches && el.matches(STICKY_CONTENT_SELECTOR)) return false;
      if (el.closest && el.closest(TABLE_CONTAINER_SELECTOR)) return false;
      if (el.querySelector && el.querySelector(TABLE_CONTAINER_SELECTOR)) return false;
    }
    return !isPositionedAppContainer(el, doc);
  }

  function isElementInChrome(el, doc) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches && el.matches(CHROME_CONTAINER_SELECTOR)) return true;
    if (el.closest && el.closest(CHROME_CONTAINER_SELECTOR)) return true;
    if (el.matches && el.matches('header, [role="banner"]')) {
      return !(el.closest && el.closest(MAIN_SELECTOR)) && !(el.querySelector && el.querySelector(MAIN_SELECTOR));
    }
    var banner = el.closest ? el.closest('header, [role="banner"]') : null;
    if (banner) {
      return !(banner.closest && banner.closest(MAIN_SELECTOR))
        && !(el.closest && el.closest(MAIN_SELECTOR) && banner.contains(el.closest(MAIN_SELECTOR)));
    }
    return isFloatingChrome(el, doc);
  }

  function isIgnoredOrTinyIframe(frame, doc) {
    if (!frame || frame.tagName !== 'IFRAME') return true;
    if (isElementSelfHidden(frame) || isElementInChrome(frame, doc)) return true;
    var attrs = ['width', 'height'];
    for (var i = 0; i < attrs.length; i += 1) {
      var raw = frame.getAttribute(attrs[i]);
      if (!raw) continue;
      var m = /^(\\d+(?:\\.\\d+)?)\\s*(?:px)?$/i.exec(raw.trim());
      if (m && Number(m[1]) <= 10) return true;
    }
    try {
      if (frame.getBoundingClientRect) {
        var r = frame.getBoundingClientRect();
        var rootRect = doc.documentElement && doc.documentElement.getBoundingClientRect
          ? doc.documentElement.getBoundingClientRect()
          : null;
        if (rootRect && rootRect.width > 0 && ((r.width > 0 || r.height > 0) && (r.width <= 10 || r.height <= 10))) {
          return true;
        }
      }
    } catch (_) {}
    var src = frame.getAttribute('src') || '';
    return src ? IGNORED_IFRAME_RE.test(src) : false;
  }

  function measureDocMainText(doc, depth, visitedDocs) {
    if (!doc || !doc.body || depth > 2) return 0;
    if (!visitedDocs) visitedDocs = [];
    if (visitedDocs.indexOf(doc) >= 0) return 0;
    visitedDocs.push(doc);

    var visitedNodes = typeof Set === 'function' ? new Set() : null;
    function walk(node, ignoreChrome) {
      if (!node) return 0;
      if (node.nodeType === 3) return normLen(node.textContent);
      if (node.nodeType !== 1 && node.nodeType !== 11) return 0;
      if (node.nodeType === 1) {
        if (visitedNodes) {
          if (visitedNodes.has(node)) return 0;
          visitedNodes.add(node);
        }
        if (SKIP_TAGS[node.tagName]) return 0;
        if (isElementSelfHidden(node)) return 0;
        if (ignoreChrome && isElementInChrome(node, doc)) return 0;
        if (node.tagName === 'IFRAME') {
          if (isIgnoredOrTinyIframe(node, doc)) return 0;
          try {
            var childDoc = node.contentDocument;
            if (childDoc && childDoc.body) {
              return measureDocMainText(childDoc, depth + 1, visitedDocs);
            }
          } catch (_) {}
          return 0;
        }
        if (node.tagName === 'SLOT' && typeof node.assignedNodes === 'function') {
          var assigned = node.assignedNodes({ flatten: true });
          var slotSource = assigned && assigned.length > 0 ? assigned : node.childNodes;
          var sum = 0;
          for (var s = 0; s < slotSource.length; s += 1) sum += walk(slotSource[s], ignoreChrome);
          return sum;
        }
        if (node.shadowRoot) {
          var srChildren = node.shadowRoot.childNodes;
          var srSum = 0;
          for (var sr = 0; sr < srChildren.length; sr += 1) srSum += walk(srChildren[sr], ignoreChrome);
          return srSum;
        }
      }
      var children = node.childNodes;
      var total = 0;
      for (var c = 0; c < children.length; c += 1) total += walk(children[c], ignoreChrome);
      return total;
    }

    var allMains = doc.querySelectorAll ? doc.querySelectorAll(MAIN_SELECTOR) : [];
    var explicitMains = [];
    for (var i = 0; i < allMains.length; i += 1) {
      var candidate = allMains[i];
      var ancHidden = false;
      for (var p = candidate; p && p.nodeType === 1; p = p.parentElement) {
        if (isElementSelfHidden(p) || (p !== candidate && isElementInChrome(p, doc))) {
          ancHidden = true;
          break;
        }
      }
      if (!ancHidden) explicitMains.push(candidate);
    }
    if (explicitMains.length > 0) {
      var topMains = explicitMains.filter(function (el) {
        for (var j = 0; j < explicitMains.length; j += 1) {
          if (explicitMains[j] !== el && explicitMains[j].contains && explicitMains[j].contains(el)) {
            return false;
          }
        }
        return true;
      });
      var sum = 0;
      for (var m = 0; m < topMains.length; m += 1) sum += walk(topMains[m], true);
      return sum;
    }
    return walk(doc.body, true);
  }
`;

/** 浏览器端就绪采样脚本：同时返回 body 可见字数与排除外围噪音/固定遮罩后的主区可见字数。 */
export function buildReadinessSampleScript(): string {
  return `(() => {
${SHARED_DOM_HELPERS}
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
    return {
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
${SHARED_DOM_HELPERS}
${SCROLL_HELPER_SCRIPT}
  return readScrollProbe();
})()`;
}

/** 浏览器端单步轻量滚动脚本：向下推进约一屏，用于触发 append-only 懒加载正文。 */
export function buildScrollStepScript(options: { readonly stepMultiplier?: number } = {}): string {
  const multiplier = typeof options.stepMultiplier === 'number' && Number.isFinite(options.stepMultiplier) && options.stepMultiplier > 0
    ? options.stepMultiplier
    : 1;
  return `(() => {
${SHARED_DOM_HELPERS}
${SCROLL_HELPER_SCRIPT}
  var target = findScrollTarget();
  var maxScroll = Math.max(0, target.scrollHeight - target.viewportHeight);
  var delta = Math.max(100, Math.round(target.viewportHeight * ${multiplier}));
  var nextY = Math.min(maxScroll, target.scrollY + delta);
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

/**
 * 浏览器端只读 DOM 采集脚本（不破坏原页面），严格按以下顺序执行：
 * 1. 先判访问壁垒与登录遮罩（在移除任何固定浮层前）；
 * 2. 保护明确关联的可展开折叠正文（`aria-expanded`/`read-more`/`details`）；
 * 3. 在离线克隆副本中展平开放 Shadow DOM 与内联同源 iframe（按子文档 URL 解析相对路径）；
 * 4. 执行计算样式剪枝（不删 `opacity: 0`）与懒加载图片地址回填。
 */
export function buildDomCaptureScript(): string {
  return `(() => {
${SHARED_DOM_HELPERS}
  var CAPTCHA_SELECTOR = '[id*="captcha" i], [class*="captcha" i], [data-sitekey], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i]';
  // reCAPTCHA v3 的角标只表示页面接入了评分，不向访问者出题，不是访问屏障。
  var CAPTCHA_BADGE_SELECTOR = '.grecaptcha-badge';
  var BARRIER_MIN_MAIN_TEXT = 500;
  var LOGIN_GATE_RE = /(?:登录(?:后?(?:查看|阅读|继续|解锁))|请先登录|立即登录|扫码登录|账号登录|sign\\s+in\\s+to\\s+(?:continue|read|view)|log\\s+in\\s+to\\s+(?:continue|read|view)|create\\s+an?\\s+account\\s+to\\s+continue)/i;
  var VOID_TAGS = { AREA: 1, BASE: 1, BR: 1, COL: 1, EMBED: 1, HR: 1, IMG: 1, INPUT: 1, LINK: 1, META: 1, PARAM: 1, SOURCE: 1, TRACK: 1, WBR: 1 };
  // 上限只为防止病态页面拖垮渲染进程；真实的长表格（数千行）和深层嵌套页面应当完整采集。
  // 触达上限时必须带 capture_truncated 提示，不能让调用方把残缺内容当成全文。
  var MAX_CLONE_NODES = 200000;
  var MAX_CLONE_DEPTH = 256;
  var MAX_IFRAME_DEPTH = 2;
  var MAX_INLINED_FRAMES = 8;

  function hasLayoutEngine(doc) {
    try {
      return Boolean(doc && doc.documentElement && doc.documentElement.getBoundingClientRect
        && doc.documentElement.getBoundingClientRect().width > 0);
    } catch (_) {
      return false;
    }
  }

  function isVisiblyRendered(el, doc) {
    if (!el || el.nodeType !== 1) return false;
    for (var p = el; p && p.nodeType === 1; p = p.parentElement) {
      if (isElementSelfHidden(p)) return false;
      var st = safeStyle(p);
      if (st && st.opacity !== '' && Number.parseFloat(st.opacity) <= 0.05) return false;
    }
    if (hasLayoutEngine(doc) && el.getBoundingClientRect) {
      var rect = el.getBoundingClientRect();
      var stSelf = safeStyle(el);
      if ((!stSelf || stSelf.display !== 'contents')
        && rect.width <= 0 && rect.height <= 0
        && (!el.getClientRects || el.getClientRects().length === 0)) {
        return false;
      }
    }
    return true;
  }

  // 浮层 = 对话框，或被判为页面外围的 fixed/sticky 元素；固定表头、应用容器这类定位正文不算。
  function isOverlayElement(el, doc) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches && el.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return true;
    return isFloatingChrome(el, doc);
  }

  function findVisibleOverlayAncestor(el, doc) {
    for (var p = el; p && p.nodeType === 1 && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
      if (isOverlayElement(p, doc) && isVisiblyRendered(p, doc)) return p;
    }
    return null;
  }

  /**
   * 视口是否被浮层挡住：在 3×3 个采样点上做命中测试，多数点落在浮层（含遮罩背景）上才算。
   * 角落的登录提示卡、底部提示条、侧栏吸顶卡片都不挡正文，页面仍然可读，不能据此判成访问屏障。
   * 没有排版引擎（单元测试的 DOM）时无法命中测试，按“挡住”处理，交给调用方的其余条件判断。
   */
  function isViewportObscured(doc) {
    var win = doc.defaultView;
    if (!hasLayoutEngine(doc) || !win || typeof doc.elementFromPoint !== 'function') return true;
    var vw = win.innerWidth;
    var vh = win.innerHeight;
    if (!(vw > 0 && vh > 0)) return true;
    var fractions = [0.2, 0.5, 0.8];
    var covered = 0;
    for (var xi = 0; xi < fractions.length; xi += 1) {
      for (var yi = 0; yi < fractions.length; yi += 1) {
        var hit = doc.elementFromPoint(vw * fractions[xi], vh * fractions[yi]);
        if (hit && findVisibleOverlayAncestor(hit, doc)) covered += 1;
      }
    }
    return covered >= 5;
  }

  // 第一步：在移除任何浮层之前先识别可见人机验证与登录遮罩，防止露出截断壳。
  // 判成屏障的前提是访问者确实读不到正文：浮层挡住了视口，或页面主区本身没有多少文字。
  function detectAccessBarrier(doc, mainTextLen) {
    if (!doc || !doc.body) return null;
    var layoutActive = hasLayoutEngine(doc);
    var contentThin = mainTextLen < BARRIER_MIN_MAIN_TEXT;
    var obscuredCache = null;
    function contentBlocked() {
      if (contentThin) return true;
      if (obscuredCache === null) obscuredCache = isViewportObscured(doc);
      return obscuredCache;
    }
    var captchaNodes = doc.querySelectorAll ? doc.querySelectorAll(CAPTCHA_SELECTOR) : [];
    for (var c = 0; c < captchaNodes.length; c += 1) {
      var cap = captchaNodes[c];
      if (cap.closest && cap.closest(CAPTCHA_BADGE_SELECTOR)) continue;
      if (!isVisiblyRendered(cap, doc)) continue;
      if (contentThin || (findVisibleOverlayAncestor(cap, doc) && contentBlocked())) return 'captcha';
    }
    var pwNodes = doc.querySelectorAll ? doc.querySelectorAll('input[type="password"]') : [];
    for (var p = 0; p < pwNodes.length; p += 1) {
      var pw = pwNodes[p];
      if (!isVisiblyRendered(pw, doc)) continue;
      if (contentThin || (findVisibleOverlayAncestor(pw, doc) && contentBlocked())) return 'login_required';
    }
    var overlayCandidates = doc.querySelectorAll
      ? doc.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], div, section, aside, form')
      : [];
    for (var i = 0; i < overlayCandidates.length; i += 1) {
      var el = overlayCandidates[i];
      if (!isOverlayElement(el, doc) || !isVisiblyRendered(el, doc)) continue;
      if (layoutActive && el.getBoundingClientRect) {
        var r = el.getBoundingClientRect();
        var isDialog = el.matches && el.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]');
        if (!isDialog && (r.width < 200 || r.height < 120)) continue;
      }
      var overlayText = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (overlayText && overlayText.length <= 2000 && LOGIN_GATE_RE.test(overlayText) && contentBlocked()) {
        return 'login_required';
      }
    }
    return null;
  }

  function hasReadMoreName(el) {
    if (!el || !el.classList) return false;
    var names = [];
    for (var i = 0; i < el.classList.length; i += 1) names.push(el.classList[i]);
    if (el.id) names.push(el.id);
    for (var j = 0; j < names.length; j += 1) {
      if (/^(?:read|show)[-_]?more(?:[-_]|$)/i.test(names[j])) return true;
    }
    return false;
  }

  function isVisibleControl(control, doc) {
    if (!control || (control.matches && control.matches('[disabled], [aria-disabled="true" i]'))) return false;
    for (var node = control; node && node.nodeType === 1; node = node.parentElement) {
      if (isElementSelfHidden(node)) return false;
    }
    return !hasLayoutEngine(doc) || isVisiblyRendered(control, doc);
  }

  // 第二步：先收集明确关联的可展开折叠正文与 <details>（与其内部隐藏旧值分层处理）。
  function collectProtectedDisclosures(doc) {
    var protectedSet = new Set();
    var protectedAncestors = new Set();
    if (!doc || !doc.querySelectorAll) {
      return { protectedSet: protectedSet, protectedAncestors: protectedAncestors };
    }
    var controls = doc.querySelectorAll(CONTROL_SELECTOR);
    for (var i = 0; i < controls.length; i += 1) {
      var control = controls[i];
      var main = control.closest ? control.closest(MAIN_SELECTOR) : null;
      if (!main || !isVisibleControl(control, doc)) continue;
      if (control.getAttribute && control.getAttribute('aria-expanded') === 'false') {
        var ids = (control.getAttribute('aria-controls') || '').split(/\\s+/).filter(Boolean);
        for (var k = 0; k < ids.length; k += 1) {
          var target = doc.getElementById ? doc.getElementById(ids[k]) : null;
          if (target && target !== main && target.closest && target.closest(MAIN_SELECTOR) === main) {
            protectedSet.add(target);
          }
        }
      }
      if (hasReadMoreName(control)) {
        var wrapper = control.parentElement;
        var sibling = control.nextElementSibling
          || (wrapper && wrapper.children && wrapper.children.length === 1 ? wrapper.nextElementSibling : null);
        if (sibling && hasReadMoreName(sibling) && sibling.closest && sibling.closest(MAIN_SELECTOR) === main) {
          protectedSet.add(sibling);
        }
      }
    }
    var detailsList = doc.querySelectorAll('details');
    for (var d = 0; d < detailsList.length; d += 1) {
      var det = detailsList[d];
      var detMain = det.closest ? det.closest(MAIN_SELECTOR) : null;
      if (!detMain || isElementSelfHidden(det)) continue;
      protectedSet.add(det);
    }
    protectedSet.forEach(function (target) {
      for (var p = target.parentElement; p && p.nodeType === 1; p = p.parentElement) {
        protectedAncestors.add(p);
      }
    });
    return { protectedSet: protectedSet, protectedAncestors: protectedAncestors };
  }

  function resolveHttpUrl(raw, baseUrl) {
    if (!raw || typeof raw !== 'string') return null;
    var trimmed = raw.trim();
    if (!trimmed) return null;
    var lower = trimmed.toLowerCase();
    if (lower.indexOf('javascript:') === 0 || lower.indexOf('data:') === 0
      || lower.indexOf('blob:') === 0 || lower.indexOf('vbscript:') === 0) {
      return null;
    }
    try {
      var parsed = new URL(trimmed, baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.href;
    } catch (_) {
      return null;
    }
  }

  function resolveSrcsetAttr(raw, baseUrl) {
    if (!raw) return null;
    var parts = raw.split(/,\\s+(?=\\S)/);
    var resolved = [];
    for (var i = 0; i < parts.length; i += 1) {
      var segs = parts[i].trim().split(/\\s+/);
      if (!segs[0]) continue;
      var abs = resolveHttpUrl(segs[0], baseUrl);
      if (!abs) continue;
      resolved.push(segs[1] ? abs + ' ' + segs[1] : abs);
    }
    return resolved.length > 0 ? resolved.join(', ') : null;
  }

  function stripHiddenInlineDeclarations(rawStyle) {
    if (!rawStyle) return '';
    var kept = [];
    var parts = rawStyle.split(';');
    for (var i = 0; i < parts.length; i += 1) {
      var decl = parts[i].trim();
      if (!decl) continue;
      var sep = decl.indexOf(':');
      if (sep < 0) continue;
      var prop = decl.slice(0, sep).trim().toLowerCase();
      var val = decl.slice(sep + 1).trim().toLowerCase().replace(/\\s*!important$/, '');
      if ((prop === 'display' && val === 'none')
        || (prop === 'visibility' && (val === 'hidden' || val === 'collapse'))) {
        continue;
      }
      kept.push(decl);
    }
    return kept.join('; ');
  }

  function copySafeAttributes(srcEl, dstEl, isProtectedRoot) {
    if (!srcEl.attributes) return;
    for (var i = 0; i < srcEl.attributes.length; i += 1) {
      var attr = srcEl.attributes[i];
      var name = attr.name.toLowerCase();
      if (name.indexOf('on') === 0) continue;
      if (isProtectedRoot && (name === 'hidden' || name === 'aria-hidden')) continue;
      if (isProtectedRoot && name === 'style') {
        var cleaned = stripHiddenInlineDeclarations(attr.value);
        if (cleaned) dstEl.setAttribute('style', cleaned);
        continue;
      }
      try {
        dstEl.setAttribute(attr.name, attr.value);
      } catch (_) {}
    }
  }

  function shouldPruneNormalElement(el, doc, ancestorsOfProtected) {
    if (SKIP_TAGS[el.tagName]) return true;
    if (el.matches && el.matches(HIDDEN_ATTR_SELECTOR + ', [inert], input[type="hidden" i], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
      return true;
    }
    if (hasHiddenInlineStyle(el)) return true;
    var st = safeStyle(el);
    if (st) {
      if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return true;
      if (!ancestorsOfProtected.has(el) && isFloatingChrome(el, doc)) return true;
    }
    // 故意不按 opacity: 0 剪枝，保留滚入渐显文本。
    if (!VOID_TAGS[el.tagName]
      && el.tagName !== 'HTML' && el.tagName !== 'BODY'
      && el.tagName !== 'DETAILS' && el.tagName !== 'SUMMARY'
      && !ancestorsOfProtected.has(el)
      && hasLayoutEngine(doc)
      && el.getBoundingClientRect) {
      if (!st || st.display !== 'contents') {
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0 && (!el.getClientRects || el.getClientRects().length === 0)) {
          return true;
        }
      }
    }
    return false;
  }

  function shouldPruneInsideProtected(el) {
    if (SKIP_TAGS[el.tagName]) return true;
    if (el.matches && el.matches(HIDDEN_ATTR_SELECTOR + ', [inert], input[type="hidden" i]')) return true;
    if (hasHiddenInlineStyle(el)) return true;
    var st = safeStyle(el);
    if (!st) return false;
    if (st.display === 'none') return true;
    if (st.visibility === 'hidden' || st.visibility === 'collapse') {
      var parentSt = el.parentElement ? safeStyle(el.parentElement) : null;
      if (!parentSt || (parentSt.visibility !== 'hidden' && parentSt.visibility !== 'collapse')) {
        return true;
      }
    }
    return false;
  }

  function resolveDocBaseUrl(doc, fallbackUrl) {
    var baseAttr = doc.querySelector ? (doc.querySelector('base[href]') && doc.querySelector('base[href]').getAttribute('href')) : null;
    if (baseAttr) {
      var resolved = resolveHttpUrl(baseAttr, fallbackUrl);
      if (resolved) return resolved;
    }
    return fallbackUrl;
  }

  function readFrameLabel(frame) {
    var attrs = ['title', 'aria-label', 'name'];
    for (var i = 0; i < attrs.length; i += 1) {
      var v = frame.getAttribute ? frame.getAttribute(attrs[i]) : null;
      if (v && v.replace(/\\s+/g, ' ').trim()) {
        return v.replace(/\\s+/g, ' ').trim().slice(0, 200);
      }
    }
    return 'Embedded frame document';
  }

  var rootMainTextLength = measureDocMainText(document, 0);
  var rootBarrier = detectAccessBarrier(document, rootMainTextLength);
  if (rootBarrier) {
    return {
      html: '',
      accessBarrier: rootBarrier,
      warnings: [],
      inlinedFrameResources: [],
      mainTextLength: rootMainTextLength,
    };
  }

  var outDoc = document.implementation.createHTMLDocument('');
  while (outDoc.head && outDoc.head.firstChild) {
    outDoc.head.removeChild(outDoc.head.firstChild);
  }
  var rootLang = document.documentElement ? document.documentElement.getAttribute('lang') : '';
  if (rootLang) outDoc.documentElement.setAttribute('lang', rootLang);

  var pageHref = (document.URL && /^https?:/i.test(document.URL)) ? document.URL : location.href;
  var rootBaseUrl = resolveDocBaseUrl(document, pageHref);

  var copiedTitle = false;
  if (document.head && outDoc.head) {
    var headNodes = document.head.querySelectorAll('title, meta, base, link[rel="canonical"], script[type="application/ld+json"]');
    for (var h = 0; h < headNodes.length; h += 1) {
      var srcHead = headNodes[h];
      var clonedHead = outDoc.createElement(srcHead.tagName.toLowerCase());
      copySafeAttributes(srcHead, clonedHead, false);
      if (srcHead.tagName === 'TITLE' || srcHead.tagName === 'SCRIPT') {
        clonedHead.textContent = srcHead.textContent || '';
        if (srcHead.tagName === 'TITLE' && clonedHead.textContent.trim()) {
          copiedTitle = true;
        }
      }
      outDoc.head.appendChild(clonedHead);
    }
  }
  if (!copiedTitle && outDoc.head && document.title && document.title.trim()) {
    var titleEl = outDoc.createElement('title');
    titleEl.textContent = document.title;
    outDoc.head.appendChild(titleEl);
  }
  if (!outDoc.querySelector('base[href]') && outDoc.head) {
    var injectedBase = outDoc.createElement('base');
    injectedBase.setAttribute('href', rootBaseUrl);
    outDoc.head.appendChild(injectedBase);
  }

  var state = {
    nodeCount: 0,
    warnings: [],
    inlinedFrameResources: [],
    seenFrameUrls: new Set(),
    barrier: null,
  };

  function addWarning(w) {
    if (state.warnings.indexOf(w) < 0) state.warnings.push(w);
  }

  function cloneSubtree(srcNode, ctx) {
    if (!srcNode || state.barrier) return null;
    if (state.nodeCount >= MAX_CLONE_NODES || ctx.depth > MAX_CLONE_DEPTH) {
      addWarning('capture_truncated');
      return null;
    }
    if (srcNode.nodeType === 3) {
      var val = srcNode.nodeValue;
      if (!val) return null;
      state.nodeCount += 1;
      return outDoc.createTextNode(val);
    }
    if (srcNode.nodeType !== 1) return null;

    var tag = srcNode.tagName;
    if (SKIP_TAGS[tag]) return null;

    var isProtectedRoot = ctx.protectedSet.has(srcNode);
    if (!isProtectedRoot) {
      if (ctx.insideProtected) {
        if (shouldPruneInsideProtected(srcNode)) return null;
      } else if (shouldPruneNormalElement(srcNode, ctx.doc, ctx.protectedAncestors)) {
        return null;
      }
    }

    // 处理同源 / 同站跨源 iframe：仅同源非空正文内联进副本，跨源保留带绝对 src 的标签供 Node 侧提取资源链接。
    if (tag === 'IFRAME') {
      if (isIgnoredOrTinyIframe(srcNode, ctx.doc)) return null;
      var rawFrameSrc = srcNode.getAttribute('src');
      var resolvedFrameSrc = resolveHttpUrl(rawFrameSrc, ctx.baseUrl);
      var childDoc = null;
      try {
        childDoc = srcNode.contentDocument || null;
      } catch (_) {
        childDoc = null;
      }
      if (childDoc && childDoc.body && ctx.iframeDepth < MAX_IFRAME_DEPTH
        && state.inlinedFrameResources.length < MAX_INLINED_FRAMES) {
        var childUrl = (childDoc.URL && /^https?:/i.test(childDoc.URL) && childDoc.URL !== 'about:blank')
          ? childDoc.URL
          : resolvedFrameSrc;
        var hasContent = normLen(childDoc.body.innerText || childDoc.body.textContent) >= 40
          || Boolean(childDoc.body.querySelector && childDoc.body.querySelector('table tr'));
        if (childUrl && hasContent && !state.seenFrameUrls.has(childUrl)) {
          var childMainLen = measureDocMainText(childDoc, 0);
          var childBarrier = detectAccessBarrier(childDoc, childMainLen);
          if (childBarrier) {
            state.barrier = childBarrier;
            return null;
          }
          state.seenFrameUrls.add(childUrl);
          state.inlinedFrameResources.push({
            kind: 'source',
            url: childUrl,
            label: readFrameLabel(srcNode),
          });
          addWarning('inlined_same_origin_iframe');
          var frameWrapper = outDoc.createElement('section');
          frameWrapper.setAttribute('data-linnya-inlined-frame', 'true');
          frameWrapper.setAttribute('data-frame-url', childUrl);
          var childBaseUrl = resolveDocBaseUrl(childDoc, childUrl);
          var childProt = collectProtectedDisclosures(childDoc);
          var childCtx = {
            doc: childDoc,
            baseUrl: childBaseUrl,
            depth: ctx.depth + 1,
            iframeDepth: ctx.iframeDepth + 1,
            insideProtected: false,
            protectedSet: childProt.protectedSet,
            protectedAncestors: childProt.protectedAncestors,
          };
          var childNodes = childDoc.body.childNodes;
          for (var f = 0; f < childNodes.length; f += 1) {
            var clonedFrameNode = cloneSubtree(childNodes[f], childCtx);
            if (clonedFrameNode) frameWrapper.appendChild(clonedFrameNode);
          }
          return frameWrapper;
        }
      }
      if (!resolvedFrameSrc) return null;
      state.nodeCount += 1;
      var preservedFrame = outDoc.createElement('iframe');
      copySafeAttributes(srcNode, preservedFrame, false);
      preservedFrame.setAttribute('src', resolvedFrameSrc);
      return preservedFrame;
    }

    // 处理 Shadow DOM 中的 <slot>：按 assignedNodes({ flatten: true }) 展平，避免未分配节点和重复克隆。
    if (tag === 'SLOT' && typeof srcNode.assignedNodes === 'function') {
      var assigned = srcNode.assignedNodes({ flatten: true });
      var slotItems = assigned && assigned.length > 0 ? assigned : srcNode.childNodes;
      var frag = outDoc.createDocumentFragment();
      for (var si = 0; si < slotItems.length; si += 1) {
        var clonedSlotItem = cloneSubtree(slotItems[si], {
          doc: ctx.doc,
          baseUrl: ctx.baseUrl,
          depth: ctx.depth + 1,
          iframeDepth: ctx.iframeDepth,
          insideProtected: ctx.insideProtected || isProtectedRoot,
          protectedSet: ctx.protectedSet,
          protectedAncestors: ctx.protectedAncestors,
        });
        if (clonedSlotItem) frag.appendChild(clonedSlotItem);
      }
      return frag;
    }

    state.nodeCount += 1;
    var hasShadow = Boolean(srcNode.shadowRoot);
    var outTag = hasShadow && tag.indexOf('-') >= 0
      ? ((safeStyle(srcNode) && safeStyle(srcNode).display && safeStyle(srcNode).display.indexOf('inline') === 0) ? 'span' : 'div')
      : tag.toLowerCase();
    var outEl = outDoc.createElement(outTag);
    if (hasShadow) outEl.setAttribute('data-linnya-shadow-host', tag.toLowerCase());
    copySafeAttributes(srcNode, outEl, isProtectedRoot);

    if (tag === 'A') {
      var rawHref = srcNode.getAttribute('href');
      if (rawHref) {
        if (rawHref.charAt(0) === '#') {
          outEl.setAttribute('href', rawHref);
        } else {
          var absHref = resolveHttpUrl(rawHref, ctx.baseUrl);
          if (absHref) outEl.setAttribute('href', absHref);
          else outEl.removeAttribute('href');
        }
      }
    } else if (tag === 'IMG') {
      var lazyAttrs = ['data-src', 'data-original', 'data-actualsrc', 'data-lazy-src', 'data-full-src'];
      var chosenImg = null;
      for (var la = 0; la < lazyAttrs.length; la += 1) {
        var cand = resolveHttpUrl(srcNode.getAttribute(lazyAttrs[la]), ctx.baseUrl);
        if (cand) {
          chosenImg = cand;
          break;
        }
      }
      if (!chosenImg) chosenImg = resolveHttpUrl(srcNode.getAttribute('src'), ctx.baseUrl);
      if (chosenImg) {
        outEl.setAttribute('src', chosenImg);
      } else {
        var rawImgSrc = srcNode.getAttribute('src') || '';
        if (rawImgSrc.indexOf('data:') === 0 || rawImgSrc.indexOf('blob:') === 0) {
          outEl.removeAttribute('src');
        }
      }
      var absSrcset = resolveSrcsetAttr(srcNode.getAttribute('srcset'), ctx.baseUrl);
      if (absSrcset) outEl.setAttribute('srcset', absSrcset);
    }

    if (outEl.tagName === 'DETAILS' && isProtectedRoot) {
      outEl.setAttribute('open', '');
    }

    var childSource = hasShadow ? srcNode.shadowRoot.childNodes : srcNode.childNodes;
    var nextCtx = {
      doc: ctx.doc,
      baseUrl: ctx.baseUrl,
      depth: ctx.depth + 1,
      iframeDepth: ctx.iframeDepth,
      insideProtected: ctx.insideProtected || isProtectedRoot,
      protectedSet: ctx.protectedSet,
      protectedAncestors: ctx.protectedAncestors,
    };
    for (var i = 0; i < childSource.length; i += 1) {
      var clonedChild = cloneSubtree(childSource[i], nextCtx);
      if (clonedChild) outEl.appendChild(clonedChild);
    }
    return outEl;
  }

  if (document.body && outDoc.body) {
    copySafeAttributes(document.body, outDoc.body, false);
    var rootProt = collectProtectedDisclosures(document);
    var rootCtx = {
      doc: document,
      baseUrl: rootBaseUrl,
      depth: 0,
      iframeDepth: 0,
      insideProtected: false,
      protectedSet: rootProt.protectedSet,
      protectedAncestors: rootProt.protectedAncestors,
    };
    for (var b = 0; b < document.body.childNodes.length; b += 1) {
      var clonedBodyChild = cloneSubtree(document.body.childNodes[b], rootCtx);
      if (clonedBodyChild) outDoc.body.appendChild(clonedBodyChild);
    }
  }

  if (state.barrier) {
    return {
      html: '',
      accessBarrier: state.barrier,
      warnings: [],
      inlinedFrameResources: [],
      mainTextLength: rootMainTextLength,
    };
  }

  var html = '<!doctype html>' + (outDoc.documentElement ? outDoc.documentElement.outerHTML : '');
  return {
    html: html,
    warnings: state.warnings,
    inlinedFrameResources: state.inlinedFrameResources,
    mainTextLength: rootMainTextLength,
  };
})()`;
}
