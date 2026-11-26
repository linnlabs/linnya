import { READABLE_DOM_SCRIPT } from './readableDomScript';

export { buildReadinessSampleScript, buildScrollProbeScript, buildScrollStepScript } from './buildRenderProbeScripts';

/**
 * 浏览器端只读 DOM 采集脚本（不破坏原页面），严格按以下顺序执行：
 * 1. 先判访问壁垒与登录遮罩（在移除任何固定浮层前）；
 * 2. 保护明确关联的可展开折叠正文（`aria-expanded`/`read-more`/`details`）；
 * 3. 在离线克隆副本中展平开放 Shadow DOM 与内联同源 iframe（按子文档 URL 解析相对路径）；
 * 4. 执行计算样式剪枝（不删 `opacity: 0`）与懒加载图片地址回填。
 */
export function buildDomCaptureScript(): string {
  return `(() => {
${READABLE_DOM_SCRIPT}
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
  function viewportHits(doc) {
    var win = doc.defaultView;
    if (!hasLayoutEngine(doc) || !win || typeof doc.elementFromPoint !== 'function') return [];
    var fractions = [0.2, 0.5, 0.8];
    var hits = [];
    for (var x of fractions) for (var y of fractions) hits.push(doc.elementFromPoint(win.innerWidth * x, win.innerHeight * y));
    return hits;
  }

  function isViewportObscured(doc) {
    var hits = viewportHits(doc);
    return hits.length === 0 || hits.filter(function (hit) { return hit && findVisibleOverlayAncestor(hit, doc); }).length >= 5;
  }

  function foregroundFrameBarrier(doc) {
    if (!doc.querySelector('iframe')) return null;
    var hits = viewportHits(doc);
    for (var frame of new Set(hits)) {
      if (!frame || frame.tagName !== 'IFRAME' || hits.filter(function (hit) { return hit === frame; }).length < 5) continue;
      // 先于浮层剪枝检查实际挡住父页面的框；不可访问的子文档不参与正文采集。
      var child = frame.contentDocument;
      if (child && child.body) return detectAccessBarrier(child, measureDocMainText(child, 0));
    }
    return null;
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
  var rootBarrier = detectAccessBarrier(document, rootMainTextLength) || foregroundFrameBarrier(document);
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
    inlinedFrameCount: 0,
    blockedDocuments: [],
    frameBarrier: null,
  };

  function addWarning(w) {
    if (state.warnings.indexOf(w) < 0) state.warnings.push(w);
  }

  function cloneSubtree(srcNode, ctx) {
    if (!srcNode) return null;
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
      var declaresInline = srcNode.hasAttribute('srcdoc');
      var rawFrameSrc = declaresInline ? null : srcNode.getAttribute('src');
      var resolvedFrameSrc = resolveHttpUrl(rawFrameSrc, ctx.baseUrl);
      var childDoc = null;
      try {
        childDoc = srcNode.contentDocument || null;
      } catch (_) {
        childDoc = null;
      }
      if (childDoc && childDoc.body && ctx.iframeDepth < MAX_IFRAME_DEPTH
        && state.inlinedFrameCount < MAX_INLINED_FRAMES) {
        var inlineDocument = declaresInline && childDoc.URL === 'about:srcdoc';
        var childUrl = (childDoc.URL && /^https?:/i.test(childDoc.URL) && childDoc.URL !== 'about:blank')
          ? childDoc.URL
          : resolvedFrameSrc;
        var hasContent = normLen(childDoc.body.innerText || childDoc.body.textContent) >= 40
          || Boolean(childDoc.body.querySelector && childDoc.body.querySelector('table tr'));
        var eligible = inlineDocument || (childUrl && !state.seenFrameUrls.has(childUrl));
        if (eligible) {
          var childMainLen = measureDocMainText(childDoc, 0);
          var childBarrier = detectAccessBarrier(childDoc, childMainLen);
          if (childBarrier) {
            state.frameBarrier = childBarrier;
            state.blockedDocuments.push(childDoc);
            addWarning('embedded_frame_blocked');
            return null;
          }
        }
        if (eligible && (inlineDocument || hasContent)) {
          state.inlinedFrameCount += 1;
          if (childUrl) {
            state.seenFrameUrls.add(childUrl);
            state.inlinedFrameResources.push({ kind: 'source', url: childUrl, label: readFrameLabel(srcNode) });
          }
          addWarning('inlined_same_origin_iframe');
          var frameWrapper = outDoc.createElement('section');
          frameWrapper.setAttribute('data-linnya-inlined-frame', 'true');
          if (childUrl) frameWrapper.setAttribute('data-frame-url', childUrl);
          // srcdoc 可以继承父 base，也可以声明自己的 base；浏览器已经解析了这两种情形。
          var childBaseUrl = inlineDocument ? childDoc.baseURI : resolveDocBaseUrl(childDoc, childUrl);
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

  // 受阻子文档永不内联。页面只有登录框时保留真实失败原因；公开主区仍可独立交付。
  if (state.frameBarrier && measureDocMainText(document, 0, state.blockedDocuments.slice()) === 0) {
    return {
      html: '',
      accessBarrier: state.frameBarrier,
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
