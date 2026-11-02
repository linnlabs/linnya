import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

/** 在完整 App 中回放快速来回拖动；数据只注入隔离 fixture 的项目列表。 */
export async function runSidebarResizeScenario({ cdp, evaluate, clickConversation }) {
  await clickConversation(cdp, 'E2E 对话 A');
  await evaluate(cdp, `(async () => {
    const { useWorkspaceProjectsStore } = await import('/apps/renderer/domains/workspace/store/WorkspaceProjectsStore.ts');
    const { useLayoutStore } = await import('/apps/renderer/app/layout/store/layoutStore.ts');
    const store = useWorkspaceProjectsStore();
    store.replaceProjects([...store.projects, ...Array.from({ length: 80 }, (_, index) => ({
      id: 'resize-fixture-' + index, name: 'Resize fixture project ' + index,
      description: null, icon: null, systemRole: null, canDelete: true, createdAt: 1, updatedAt: 1,
    }))]);
    useLayoutStore().setSidebarNav('list');
    await new Promise(resolve => setTimeout(resolve, 500));
  })()`);
  const traceEvents = [];
  let completeTrace;
  const traceDone = new Promise(resolve => { completeTrace = resolve; });
  const stopTrace = cdp.onEvent(event => {
    if (event.method === 'Tracing.dataCollected') traceEvents.push(...event.params.value);
    if (event.method === 'Tracing.tracingComplete') completeTrace();
  });
  if (process.env.LINNYA_RESIZE_TRACE) {
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.stack' });
  }
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    const before = await cdp.send('Performance.getMetrics');
    const sample = await evaluate(cdp, `(async () => {
      const { useUIStore } = await import('/apps/renderer/shared/stores/ui.ts');
      const ui = useUIStore();
      const divider = document.querySelector('.sidebar-shell [role="separator"]');
      if (!divider) throw new Error('Sidebar divider is missing');
      const frames = [];
      const writes = {};
      const events = { start: 0, end: 0 };
      const recordStart = () => events.start++;
      const recordEnd = () => events.end++;
      window.addEventListener('sidebar-anim-start', recordStart);
      window.addEventListener('sidebar-anim-end', recordEnd);
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        writes[key] = (writes[key] ?? 0) + 1;
        return setItem.call(this, key, value);
      };
      let last = performance.now();
      const startX = ui.sidebarWidth;
      try {
        divider.dispatchEvent(new PointerEvent('pointerdown', { clientX: startX, bubbles: true, pointerId: 1 }));
        for (let frame = 0; frame < 120; frame++) {
          // 每帧多次反向移动，验证合批、边界夹紧与快速拖动的最终落点。
          for (let move = 0; move < 8; move++) {
            const x = 200 + Math.round((Math.sin((frame * 8 + move) / 32) + 1) * 150);
            window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, pointerId: 1 }));
          }
          const now = await new Promise(requestAnimationFrame);
          frames.push(now - last);
          last = now;
        }
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 333, pointerId: 1 }));
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: 333, pointerId: 1 }));
        await Promise.resolve();
        await new Promise(requestAnimationFrame);
        await Promise.resolve();
        frames.shift();
        frames.sort((a, b) => a - b);
        return {
          projectCount: document.querySelectorAll('.project-row').length,
          p50: frames[Math.floor(frames.length * .5)], p95: frames[Math.floor(frames.length * .95)],
          max: Math.max(...frames), writes, events, width: ui.sidebarWidth,
          shellWidth: document.querySelector('.sidebar-shell').getBoundingClientRect().width,
          headerWidth: document.querySelector('.sidebar-extension').getBoundingClientRect().width,
          storedWidth: JSON.parse(localStorage.getItem('ui-settings')).sidebarWidth,
          resizing: document.body.classList.contains('panel-resizing'),
        };
      } finally {
        Storage.prototype.setItem = setItem;
        window.removeEventListener('sidebar-anim-start', recordStart);
        window.removeEventListener('sidebar-anim-end', recordEnd);
      }
    })()`);
    const after = await cdp.send('Performance.getMetrics');
    const metrics = Object.fromEntries(after.metrics.map(({ name, value }) => [
      name, value - (before.metrics.find(item => item.name === name)?.value ?? 0),
    ]).filter(([name]) => ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'].includes(name)));
    assert.ok(sample.projectCount >= 80);
    assert.equal(sample.width, 333);
    assert.equal(sample.storedWidth, 333);
    assert.equal(sample.shellWidth, 333);
    assert.equal(sample.headerWidth, 333);
    assert.equal(sample.resizing, false);
    assert.deepEqual(sample.events, { start: 1, end: 1 });
    assert.equal(sample.writes['layout-state-v3'] ?? 0, 0);
    console.log('[sidebar-resize-e2e]', JSON.stringify({ ...sample, metrics }));
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    if (process.env.LINNYA_RESIZE_TRACE) {
      await cdp.send('Tracing.end');
      await traceDone;
      writeFileSync(process.env.LINNYA_RESIZE_TRACE, JSON.stringify({ traceEvents }));
    }
    stopTrace();
  }
}
