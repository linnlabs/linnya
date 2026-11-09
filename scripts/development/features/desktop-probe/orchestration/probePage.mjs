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
