import {
  READABLE_CONTROL_SELECTOR,
  READABLE_HIDDEN_SELECTOR,
  READABLE_MAIN_SELECTOR,
  RENDER_IGNORED_IFRAME_URL_PATTERN_SOURCE,
} from '../definitions/renderCaptureContract';

export const READABLE_DOM_SCRIPT = `
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
    var src = frame.hasAttribute('srcdoc') ? '' : frame.getAttribute('src') || '';
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
    // querySelectorAll 按文档顺序返回。同一主区内的后代由 walk 统一计数。
    var roots = new Set();
    for (var i = 0; i < allMains.length; i += 1) {
      var candidate = allMains[i];
      var p = candidate;
      while (p) {
        if (roots.has(p) || isElementSelfHidden(p) || (p !== candidate && isElementInChrome(p, doc))) break;
        p = p.parentElement;
      }
      if (!p) roots.add(candidate);
    }
    if (roots.size > 0) {
      var sum = 0;
      roots.forEach(function (el) { sum += walk(el, true); });
      return sum;
    }
    return walk(doc.body, true);
  }
`;
