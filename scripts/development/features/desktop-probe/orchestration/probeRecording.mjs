import { createHash } from 'node:crypto';
import { ProbeError } from '../definitions/probeContract.mjs';
import { numberOption, usage } from '../functions/parseProbeArgs.mjs';
import { measureCurve } from '../functions/animationMetrics.mjs';
import { evaluate, unwrapCdpResult } from '../infrastructure/cdpClient.mjs';
import { writeArtifact } from '../infrastructure/instanceStore.mjs';
import { performAction } from './probeActions.mjs';
import { capturePage } from './probeObservation.mjs';
import { resolveTarget } from './probePage.mjs';

async function call(cdp, objectId, fn, values = []) {
  return unwrapCdpResult(await cdp.send('Runtime.callFunctionOn', {
    objectId, functionDeclaration: fn.toString(),
    arguments: values.map(value => ({ value })), returnByValue: true, awaitPromise: true,
  }));
}

async function recordingObject(cdp, target) {
  if (target.ref) return resolveTarget(cdp, target);
  const response = await cdp.send('Runtime.evaluate', { expression: 'window', objectGroup: 'probe' });
  unwrapCdpResult(response);
  return response.result.objectId;
}

async function beginCurve(cdp, target, properties, duration) {
  // 返回仅存活于本次 CDP 会话的采样对象。selector 可在动作之后才出现。
  const prepare = function (selector, props, duration) {
    const anchor = selector ? null : this;
    const started = performance.now();
    let frameId;
    const samples = [];
    function sample(now) {
      const element = anchor ?? document.querySelector(selector);
      let values;
      let box;
      if (element?.isConnected && element.checkVisibility()) {
        const style = getComputedStyle(element);
        values = Object.fromEntries(props.map(property => [property, style.getPropertyValue(property)]));
        const rect = element.getBoundingClientRect();
        box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      samples.push({ t: now - started, values, box });
      if (now - started < duration) frameId = requestAnimationFrame(sample);
    }
    frameId = requestAnimationFrame(sample);
    return { finish() { cancelAnimationFrame(frameId); return samples; } };
  };
  const response = await cdp.send('Runtime.callFunctionOn', {
    objectId: await recordingObject(cdp, target),
    functionDeclaration: prepare.toString(),
    arguments: [target.selector ?? null, properties, duration].map(value => ({ value })),
    objectGroup: 'probe',
  });
  unwrapCdpResult(response);
  return response.result.objectId;
}

async function recordCurve(cdp, session, target, values, action) {
  const duration = numberOption(values.duration ?? '800', '--duration', { min: 50, max: 10_000 });
  const properties = (values.props ?? 'opacity,transform,width').split(',').map(value => value.trim()).filter(Boolean);
  if (!properties.length || properties.length > 12) usage('--props 需要 1 至 12 个 CSS 属性');
  const collector = await beginCurve(cdp, target, properties, duration);
  let samples;
  try {
    await performAction(cdp, action, false);
    await evaluate(cdp, `new Promise(resolve => setTimeout(resolve, ${duration}))`, duration + 2000);
  } finally {
    samples = await call(cdp, collector, function () { return this.finish(); });
  }
  if (!samples.some(sample => sample.values)) throw new ProbeError('NOT_VISIBLE', '录制期间未看到目标元素');
  const metrics = Object.fromEntries(properties.map(property => [property, measureCurve(samples, property)]));
  const maxFrameGapMs = samples.reduce((gap, sample, index) =>
    index ? Math.max(gap, sample.t - samples[index - 1].t) : gap, 0);
  const artifact = writeArtifact(session.root, 'curve', 'json', JSON.stringify({ properties, samples, metrics, maxFrameGapMs }));
  return { frames: samples.length, maxFrameGapMs, metrics, artifacts: [artifact] };
}

async function freezeAnimations(cdp, target) {
  const freeze = async function (selector) {
    const anchor = selector ? null : this;
    // Vue 等框架会先挂载元素，再在后续绘制帧创建 CSS transition。
    const animations = await new Promise(resolve => {
      let frame;
      const timer = setTimeout(() => {
        cancelAnimationFrame(frame);
        resolve([]);
      }, 300);
      function poll() {
        const element = anchor ?? document.querySelector(selector);
        const active = element?.getAnimations({ subtree: true }).filter(animation =>
          animation.playState === 'running' || animation.playState === 'paused');
        if (active?.length) {
          clearTimeout(timer);
          resolve(active);
        } else {
          frame = requestAnimationFrame(poll);
        }
      }
      poll();
    });
    const states = animations.map(animation => ({ animation, running: animation.playState === 'running', time: animation.currentTime }));
    for (const state of states) state.animation.pause();
    await Promise.all(states.map(state => state.animation.ready));
    return {
      count: states.length,
      seek(time) {
        for (const { animation } of states) animation.currentTime = time;
      },
      restore() {
        for (const state of states) {
          state.animation.currentTime = state.time;
          if (state.running) state.animation.play();
        }
      },
    };
  };
  const response = await cdp.send('Runtime.callFunctionOn', {
    objectId: await recordingObject(cdp, target), functionDeclaration: freeze.toString(),
    arguments: [{ value: target.selector ?? null }],
    objectGroup: 'probe', awaitPromise: true,
  });
  unwrapCdpResult(response);
  return response.result.objectId;
}

async function recordFrames(cdp, session, target, values, action) {
  const times = (values.at ?? '0,40,80,160,300').split(',').map(value =>
    numberOption(value, '--at', { max: 10_000 }));
  if (times.length > 12) usage('定格拼图最多 12 帧');
  await performAction(cdp, action, false);
  const controller = await freezeAnimations(cdp, target);
  const frames = [];
  try {
    const count = await call(cdp, controller, function () { return this.count; });
    if (!count) throw new ProbeError('NOT_FOUND', '目标上没有 CSS 或 WAAPI 动效', 'JS 驱动的动效请用 record curve');
    for (const t of times) {
      await call(cdp, controller, function (t) { this.seek(t); }, [t]);
      frames.push({ t, ...await capturePage(cdp, { target, pad: 4, settle: false }) });
    }
  } finally {
    await call(cdp, controller, function () { this.restore(); });
  }
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const width = Math.max(...frames.map(frame => frame.width));
  const height = Math.max(...frames.map(frame => frame.height));
  const columns = Math.min(frames.length, 4);
  const rows = Math.ceil(frames.length / columns);
  const scale = Math.min(1, 2048 / (width * columns), 2048 / (height * rows));
  const cellWidth = Math.ceil(width * scale) + 12;
  const cellHeight = Math.ceil(height * scale) + 28;
  const canvas = createCanvas(cellWidth * columns, cellHeight * rows);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111827';
  ctx.font = '14px sans-serif';
  for (const [index, frame] of frames.entries()) {
    const x = (index % columns) * cellWidth + 6;
    const y = Math.floor(index / columns) * cellHeight + 4;
    ctx.drawImage(await loadImage(frame.buffer), x, y, frame.width * scale, frame.height * scale);
    ctx.fillText(`${frame.t} ms`, x, y + cellHeight - 11);
  }
  return {
    frames: frames.map(frame => ({ t: frame.t, sha256: createHash('sha256').update(frame.buffer).digest('hex') })),
    artifacts: [{ ...writeArtifact(session.root, 'frames', 'png', canvas.toBuffer('image/png')),
      width: canvas.width, height: canvas.height }],
  };
}

export function recordAnimation(cdp, session, kind, values, action) {
  const target = values.target.startsWith('@') ? { ref: values.target } : { selector: values.target };
  if (kind === 'curve') return recordCurve(cdp, session, target, values, action);
  if (kind === 'frames') return recordFrames(cdp, session, target, values, action);
  usage('record 只接受 curve 或 frames');
}
