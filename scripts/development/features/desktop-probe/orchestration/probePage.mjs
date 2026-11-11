import { ProbeError } from '../definitions/probeContract.mjs';
import { evaluate, unwrapCdpResult } from '../infrastructure/cdpClient.mjs';

export const pageFacts = cdp => evaluate(cdp, `({
  path: location.pathname + location.hash,
  width: innerWidth, height: innerHeight, dpr: devicePixelRatio, timeOrigin: performance.timeOrigin,
  focus: document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,
  layers: [...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')]
    .filter(element => element.checkVisibility()).map(element => ({
      role: element.getAttribute('role'), label: element.getAttribute('aria-label') || element.innerText.slice(0, 90)
    }))
})`);

export async function settlePage(cdp) {
  return evaluate(cdp, `new Promise(resolve => {
    let frames = 0;
    let next;
    const finish = settled => { clearTimeout(timer); cancelAnimationFrame(next); resolve(settled); };
    const timer = setTimeout(() => finish(false), 1500);
    const frame = () => {
      if (++frames >= 2 && !document.getAnimations().some(animation =>
        animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime))) {
        finish(true);
      } else {
        next = requestAnimationFrame(frame);
      }
    };
    next = requestAnimationFrame(frame);
  })`, 2600);
}

/**
 * text= 目标，返回候选元素数组（已按优先级收窄）：
 * 1. 直接含这段文字的可见元素；文字被拆成多段时，取包含它的最内层可见元素。
 * 2. 文字完全相同的优先于只是包含（“论文”不选“研究论文”）。
 * 3. 指针点得到的（中心点命中自身或子孙）优先于被遮挡或在视口外的。
 * 4. 仍有多个时，弹出层（菜单、列表框、对话框、popover、fixed 定位层）里的优先：它们挂在 body 末尾，按文档顺序总排在后面。
 * 收窄后仍多于一个就是歧义，由调用方报错并列出候选。
 */
function findByText(text) {
  return `(() => {
    const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim();
    const needle = ${JSON.stringify(text)};
    const exactNeedle = normalize(needle);
    const found = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const element = walker.currentNode.parentElement;
      if (!walker.currentNode.data.includes(needle) || !element?.checkVisibility()) continue;
      const exact = normalize(walker.currentNode.data) === exactNeedle || normalize(element.innerText) === exactNeedle;
      found.set(element, (found.get(element) ?? false) || exact);
    }
    if (found.size === 0) {
      const innermost = [...document.body.querySelectorAll('*')]
        .filter(element => element.checkVisibility() && element.innerText?.includes(needle)).at(-1);
      return innermost ? [innermost] : [];
    }
    const reachable = element => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit) && (hit === element || element.contains(hit) || hit.contains(element));
    };
    const inLayer = element => {
      if (element.closest('[role=menu],[role=listbox],[role=dialog],[role=alertdialog],[role=tooltip],[popover],dialog')) return true;
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).position === 'fixed') return true;
      }
      return false;
    };
    let pool = [...found.keys()];
    for (const prefer of [element => found.get(element), reachable, inLayer]) {
      const narrowed = pool.filter(prefer);
      if (narrowed.length > 0) pool = narrowed;
      if (pool.length === 1) break;
    }
    return pool;
  })()`;
}

/** 歧义时列出候选：@引用、标签名和文字，便于改用 @引用。 */
async function describeCandidates(cdp, objectIds) {
  const lines = [];
  for (const objectId of objectIds.slice(0, 6)) {
    const { node } = await cdp.send('DOM.describeNode', { objectId });
    const label = unwrapCdpResult(await cdp.send('Runtime.callFunctionOn', {
      objectId, returnByValue: true,
      functionDeclaration: `function () {
        const layer = this.closest('[role=menu],[role=listbox],[role=dialog],[role=tooltip],[popover],dialog');
        const text = (this.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 40);
        return this.tagName.toLowerCase() + ' “' + text + '”' + (layer ? '（弹出层）' : '');
      }`,
    }));
    lines.push(`@n${node.backendNodeId} ${label}`);
  }
  return lines;
}

async function resolveText(cdp, text) {
  const response = await cdp.send('Runtime.evaluate', { expression: findByText(text), objectGroup: 'probe' });
  unwrapCdpResult(response);
  const { result } = await cdp.send('Runtime.getProperties', { objectId: response.result.objectId, ownProperties: true });
  const objectIds = result
    .filter(property => /^\d+$/.test(property.name) && property.value?.objectId)
    .map(property => property.value.objectId);
  if (objectIds.length === 0) {
    throw new ProbeError('NOT_FOUND', `找不到可见文字 ${text}`, '用 probe snapshot --grep 查看页面上的实际文字');
  }
  if (objectIds.length > 1) {
    const candidates = await describeCandidates(cdp, objectIds);
    throw new ProbeError(
      'AMBIGUOUS_TARGET',
      `text=${text} 命中 ${objectIds.length} 个同样可点的元素`,
      `改用 @引用：${candidates.join('；')}${objectIds.length > candidates.length ? '；……' : ''}`,
    );
  }
  return objectIds[0];
}

export async function resolveTarget(cdp, target) {
  if (target.ref) {
    const match = /^@n(\d+)$/.exec(target.ref);
    if (!match) throw new ProbeError('USAGE', '元素引用应为 @n<number>');
    try {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: Number(match[1]), objectGroup: 'probe' });
      return object.objectId;
    } catch (error) {
      throw new ProbeError('STALE_REF', error.message, '重新运行 probe snapshot');
    }
  }
  if (target.text !== undefined) return resolveText(cdp, target.text);
  const response = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(target.selector)})`,
    objectGroup: 'probe',
  });
  unwrapCdpResult(response);
  const objectId = response.result?.objectId;
  if (!objectId) throw new ProbeError('NOT_FOUND', `找不到 ${target.selector}`);
  return objectId;
}

export async function inspectTarget(cdp, objectId, waitForStable = true) {
  return unwrapCdpResult(await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `async function (stable) {
      const rect = () => this.getBoundingClientRect().toJSON();
      const end = performance.now() + 900;
      let result = rect();
      let frames = 0;
      while (stable && frames < 2 && performance.now() < end) {
        await new Promise(resolve => {
          const timer = setTimeout(() => { cancelAnimationFrame(frame); resolve(); }, 80);
          const frame = requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
        });
        const next = rect();
        frames = ['x','y','width','height'].every(key => Math.abs(next[key] - result[key]) < 0.25) ? frames + 1 : 0;
        result = next;
      }
      const x = (Math.max(0, result.left) + Math.min(innerWidth, result.right)) / 2;
      const y = (Math.max(0, result.top) + Math.min(innerHeight, result.bottom)) / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        ...result, x, y, connected: this.isConnected, stable: !stable || frames >= 2,
        visible: this.checkVisibility() && result.width > 0 && result.height > 0,
        inView: result.right > 0 && result.bottom > 0 && result.left < innerWidth && result.top < innerHeight,
        hitsTarget: this.contains(hit), blockedBy: hit?.outerHTML.slice(0, 180), disabled: this.matches(':disabled,[aria-disabled="true"]')
      };
    }`,
    arguments: [{ value: waitForStable }], returnByValue: true, awaitPromise: true,
  }, 2000));
}

export async function locateTarget(cdp, target, { hit = true } = {}) {
  if (target.point) {
    const { width, height } = await pageFacts(cdp);
    const [x, y] = target.point;
    if (x < 0 || x >= width || y < 0 || y >= height) throw new ProbeError('NOT_VISIBLE', '坐标在视口之外');
    return { x, y };
  }
  const objectId = await resolveTarget(cdp, target);
  let box = await inspectTarget(cdp, objectId, false);
  if (box.visible && !box.inView) await cdp.send('DOM.scrollIntoViewIfNeeded', { objectId });
  box = await inspectTarget(cdp, objectId);
  if (!box.connected) throw new ProbeError('STALE_REF', '元素已从页面移除', '重新运行 probe snapshot');
  if (!box.visible || !box.inView || (hit && box.disabled)) {
    throw new ProbeError('NOT_VISIBLE', '目标不可见或不可操作');
  }
  if (!box.stable) throw new ProbeError('TIMEOUT', '目标的位置仍在变化');
  if (hit && !box.hitsTarget) throw new ProbeError('HIT_TEST_BLOCKED', `目标被遮挡：${box.blockedBy ?? '视口外'}`);
  return box;
}
