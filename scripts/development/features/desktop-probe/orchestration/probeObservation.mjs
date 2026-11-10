import { join } from 'node:path';
import { ProbeError } from '../definitions/probeContract.mjs';
import { numberOption, oneOf, usage } from '../functions/parseProbeArgs.mjs';
import { renderSnapshot } from '../functions/renderSnapshot.mjs';
import { evaluate, waitFor } from '../infrastructure/cdpClient.mjs';
import { readOptional, writeArtifact } from '../infrastructure/instanceStore.mjs';
import { locateTarget, pageFacts, resolveTarget, settlePage } from './probePage.mjs';

export async function snapshotPage(cdp, session, { target, all, limit = 50, json, grep, roles } = {}) {
  const page = await pageFacts(cdp);
  const { nodes } = target
    ? await cdp.send('Accessibility.queryAXTree', { objectId: await resolveTarget(cdp, target) })
    : await cdp.send('Accessibility.getFullAXTree');
  const snapshot = renderSnapshot(nodes, { all, limit, grep, roles });
  const header = `# ${session.options.name} · ${page.path} · ${page.width}×${page.height} · ${snapshot.entries.length}/${snapshot.total}`;
  const text = `${header}\n${snapshot.text}${snapshot.truncated ? '\n… 使用 --grep、--role、--within 或 --max-lines 缩小范围' : ''}`;
  const artifact = writeArtifact(session.root, 'snapshot', 'txt', text + '\n');
  return { page, snapshot: text, ...(json ? { entries: snapshot.entries } : {}), artifacts: [artifact] };
}

export async function capturePage(cdp, { target, clip, pad = 0, device = false, jpeg = false, settle = true } = {}) {
  const settleStarted = performance.now();
  const settled = settle ? await settlePage(cdp) : undefined;
  const settleMs = Math.round(performance.now() - settleStarted);
  const viewport = await pageFacts(cdp);
  let [left, top, width, height] = clip ?? [0, 0, viewport.width, viewport.height];
  if (target) {
    const box = await locateTarget(cdp, target, { hit: false });
    [left, top, width, height] = [box.left - pad, box.top - pad, box.width + 2 * pad, box.height + 2 * pad];
  }
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  width = Math.min(viewport.width, Math.ceil(left + width)) - x;
  height = Math.min(viewport.height, Math.ceil(top + height)) - y;
  if (width <= 0 || height <= 0) throw new ProbeError('NOT_VISIBLE', '截图范围不在视口内');
  const format = jpeg ? 'jpeg' : 'png';
  const captureStarted = performance.now();
  const response = await cdp.send('Page.captureScreenshot', {
    format, ...(jpeg ? { quality: 80 } : {}),
    clip: { x, y, width, height, scale: device ? 1 : 1 / viewport.dpr },
    captureBeyondViewport: false,
  });
  const timing = { settleMs, captureMs: Math.round(performance.now() - captureStarted) };
  const buffer = Buffer.from(response.data, 'base64');
  if (jpeg) {
    const { loadImage } = await import('@napi-rs/canvas');
    const image = await loadImage(buffer);
    return { buffer, format, width: image.width, height: image.height, settled, timing };
  }
  return { buffer, format, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), settled, timing };
}

export async function shotPage(cdp, session, options) {
  const { buffer, format, width, height, settled, timing } = await capturePage(cdp, options);
  return { settled, timing, artifacts: [{ ...writeArtifact(session.root, 'shot', format, buffer), width, height }] };
}

export async function waitForPage(cdp, values) {
  const timeout = numberOption(values.timeout ?? '10000', '--timeout', { min: 50, max: 60_000 });
  const state = oneOf(values.state ?? 'visible', ['visible', 'hidden', 'attached', 'detached'], '--state');
  const conditions = [values.selector, values.text, values.expr, values.settle].filter(value => value !== undefined);
  if (conditions.length !== 1) usage('wait 需要一个条件 --selector / --text / --expr / --settle');
  if (values.settle) return { settled: await waitFor(() => settlePage(cdp), '画面稳定', timeout) };
  let expression = values.expr;
  if (values.text !== undefined) expression = `document.body.innerText.includes(${JSON.stringify(values.text)})`;
  if (values.selector) {
    expression = `(() => {
      const element = document.querySelector(${JSON.stringify(values.selector)});
      const visible = Boolean(element?.checkVisibility() && element.getClientRects().length);
      return ({visible, hidden: !visible, attached: !!element, detached: !element})[${JSON.stringify(state)}];
    })()`;
  }
  await waitFor(() => evaluate(cdp, expression, timeout), '页面条件', timeout);
  return { matched: true };
}

export function probeLogs(session, values = {}) {
  const source = oneOf(values.source ?? 'renderer', ['renderer', 'desktop', 'vite', 'supervisor'], '--source');
  const limit = numberOption(values.limit ?? '50', '--limit', { min: 1, max: 500, integer: true });
  const since = numberOption(values.since ?? '0', '--since', { integer: true });
  if (values.level !== undefined) oneOf(values.level, ['warn', 'error'], '--level');
  const path = session.logs?.[source] ?? join(session.root, 'logs', source === 'renderer' ? 'renderer.jsonl' : `${source}.log`);
  const lines = (readOptional(path) ?? '').split('\n').filter(Boolean);
  const entries = source === 'renderer' ? lines.flatMap(line => {
    try { return [JSON.parse(line)]; } catch (error) {
      // 并发追加时最后一行可能尚未写完，下次按 cursor 续读。
      if (line === lines.at(-1) && error instanceof SyntaxError) return [];
      throw error;
    }
  }) : lines.map((text, index) => ({
    seq: index + 1, text,
    level: /\[ERROR\]|\berror\b/i.test(text) ? 'error' : /\[WARN\]|\bwarn\b/i.test(text) ? 'warn' : 'info',
  }));
  const matching = entries.filter(entry => entry.seq > since &&
    (!values.level || entry.level === values.level) && (!values.grep || entry.text.includes(values.grep)));
  const selected = since ? matching.slice(0, limit) : matching.slice(-limit);
  return { source, path, cursor: selected.at(-1)?.seq ?? since, entries: selected, total: matching.length };
}
