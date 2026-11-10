import { ProbeError } from '../definitions/probeContract.mjs';
import { resolveKeySequence } from '../functions/probeKeys.mjs';
import { evaluate } from '../infrastructure/cdpClient.mjs';
import { locateTarget, settlePage } from './probePage.mjs';

function mouse(cdp, type, point, params = {}) {
  return cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, ...params });
}

export async function clickTarget(cdp, target, { button = 'left', count = 1 } = {}) {
  const point = await locateTarget(cdp, target);
  const buttons = { left: 1, right: 2, middle: 4 }[button];
  await mouse(cdp, 'mouseMoved', point);
  for (let clickCount = 1; clickCount <= count; clickCount++) {
    await mouse(cdp, 'mousePressed', point, { button, buttons, clickCount });
    await mouse(cdp, 'mouseReleased', point, { button, buttons: 0, clickCount });
  }
  return { at: [point.x, point.y] };
}

export async function dragTarget(cdp, target, { by, to, steps = 10, sample, follow, tolerance = 2 }) {
  const from = await locateTarget(cdp, target);
  const end = to ? await locateTarget(cdp, to) : { x: from.x + by[0], y: from.y + by[1] };
  const baseline = sample ? await evaluate(cdp, sample) : undefined;
  const samples = [];
  let point = from;
  await mouse(cdp, 'mouseMoved', from);
  await mouse(cdp, 'mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
  try {
    for (let step = 1; step <= steps; step++) {
      const dx = (end.x - from.x) * step / steps;
      const dy = (end.y - from.y) * step / steps;
      point = { x: from.x + dx, y: from.y + dy };
      await mouse(cdp, 'mouseMoved', point, { button: 'left', buttons: 1 });
      if (sample) {
        // Vue 批次和 rAF 驱动的 resize 都应在这一输入步处理完，才读取该步的值。
        const value = await evaluate(cdp, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve((${sample})))) )`, 1800);
        samples.push({ step, dx, dy, value });
      }
    }
  } finally {
    await mouse(cdp, 'mouseReleased', point, { button: 'left', buttons: 0, clickCount: 1 });
  }
  if (follow) {
    const axis = follow === 'x' ? 'dx' : 'dy';
    const invalid = !Number.isFinite(baseline) || samples.some(entry =>
      !Number.isFinite(entry.value) || Math.abs(entry.value - baseline - entry[axis]) > tolerance);
    if (invalid) throw new ProbeError('FOLLOW_MISMATCH', `拖动未在 ${tolerance}px 容差内跟随 ${follow}`, undefined, { baseline, samples });
  }
  return { from: [from.x, from.y], to: [end.x, end.y], baseline, samples };
}

async function press(cdp, input) {
  const sequence = resolveKeySequence(input);
  const event = (type, key, modifiers, extra = {}) => cdp.send('Input.dispatchKeyEvent', {
    type, key: key.key, code: key.code, windowsVirtualKeyCode: key.virtual, modifiers, ...extra,
  });
  const held = [];
  let mask = 0;
  try {
    for (const modifier of sequence.modifiers) {
      mask |= modifier.mask;
      await event('rawKeyDown', modifier, mask);
      held.push(modifier);
    }
    const text = mask & 7 ? undefined : sequence.text;
    // 合成按键绕过 macOS 原生菜单，编辑指令需要随按下事件交给 Chromium。
    await event(text ? 'keyDown' : 'rawKeyDown', sequence, mask, {
      text, commands: sequence.editingCommand ? [sequence.editingCommand] : undefined,
    });
    await event('keyUp', sequence, mask);
  } finally {
    for (const modifier of held.reverse()) {
      mask &= ~modifier.mask;
      await event('keyUp', modifier, mask);
    }
  }
}

export async function performAction(cdp, { command, target, button, text, key, dx, dy, ...drag }, settle = true) {
  let result;
  if (command === 'click' || command === 'dblclick') {
    result = await clickTarget(cdp, target, { button, count: command === 'dblclick' ? 2 : 1 });
  } else if (command === 'hover') {
    const point = await locateTarget(cdp, target);
    await mouse(cdp, 'mouseMoved', point);
    result = { at: [point.x, point.y] };
  } else if (command === 'type') {
    if (target) await clickTarget(cdp, target);
    await cdp.send('Input.insertText', { text });
  } else if (command === 'press') {
    await press(cdp, key);
  } else if (command === 'scroll') {
    await mouse(cdp, 'mouseWheel', await locateTarget(cdp, target), { deltaX: dx, deltaY: dy });
  } else if (command === 'drag') {
    result = await dragTarget(cdp, target, drag);
  }
  return { ...result, ...(settle ? { settled: await settlePage(cdp) } : {}) };
}
