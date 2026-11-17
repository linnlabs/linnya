import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { checkHeaderInvariants, trafficLightsRect } from '../functions/headerInvariants.mjs';
import { rendererStore } from '../functions/rendererStore.mjs';
import { settleExpression } from '../orchestration/probePage.mjs';

/** 条件组合。侧栏 null 表示收起；窗口 980 是主窗口的最小宽度。 */
export const HEADER_SCAN_MATRIX = {
  pages: ['conversation', 'document'],
  windows: [1400, 980],
  fullscreen: [false, true],
  locales: ['zh-CN', 'en-US'],
  updates: ['idle', 'downloading', 'ready', 'installing'],
  sidebars: [null, 200, 230, 260, 320, 400, 500],
};
const WINDOW_HEIGHT = 900;

/** 页面内测量：只读矩形、命中、拖动区和文字截断事实，判断留给 checkHeaderInvariants。 */
const measureSource = `() => {
  const header = document.querySelector('.app-header');
  const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const shown = element => Boolean(element) && element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    && element.getBoundingClientRect().width > 0;
  const describe = element => element
    ? element.getAttribute?.('aria-label') || element.className?.toString().split(' ')[0] || element.tagName
    : '空白';
  const region = element => {
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const value = getComputedStyle(node).getPropertyValue('-webkit-app-region');
      if (value === 'drag' || value === 'no-drag') return value;
    }
    return 'none';
  };
  // 左、中、右三点都要点到自己：只查中心点会漏掉被遮住一半的按钮。
  const hits = element => {
    const r = element.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const missedHits = [];
    let coveredBy;
    for (const x of [r.left + 2, r.left + r.width / 2, r.right - 2]) {
      const top = document.elementFromPoint(x, y);
      if (top && (top === element || element.contains(top))) continue;
      missedHits.push(Math.round(x));
      coveredBy ??= describe(top);
    }
    return { missedHits, coveredBy };
  };
  const text = element => ({
    content: element.textContent.trim(), truncated: element.scrollWidth > element.clientWidth + 1,
    visibleWidth: element.clientWidth, fontSize: parseFloat(getComputedStyle(element).fontSize),
  });
  const elements = [];
  const control = (key, group, element, texts = []) => {
    if (shown(element)) elements.push({ key, group, rect: box(element), appRegion: region(element), ...hits(element), texts });
  };
  control('sidebar-toggle', 'left', header.querySelector('.app-header-left .sidebar-toggle'));
  control('knowledge-base', 'left', header.querySelector('.app-header-left .knowledge-base-button'));
  control('settings', 'left', header.querySelector('.app-header-left .settings-button'));
  const pill = header.querySelector('.app-update-entry__pill:not(.app-update-entry__measure)');
  const label = pill?.querySelector('.app-update-entry__label');
  if (pill) control('update-entry', 'update', pill, shown(label) ? [text(label)] : []);
  else control('update-entry', 'update', header.querySelector('.app-update-entry__button'));
  for (const button of header.querySelectorAll('.app-header-right .header-pane__actions button, .app-header-right .workspace-right-toggle button')) {
    control('right:' + describe(button), 'right', button);
  }
  for (const title of header.querySelectorAll('.app-header-right .header-pane__title')) {
    if (!shown(title)) continue;
    elements.push({
      key: title.closest('.header-pane--right') ? 'title:right' : 'title:main', group: 'title', rect: box(title),
      texts: [...title.querySelectorAll('.breadcrumb-segment')].map(text),
    });
  }
  const headerBox = box(header);
  const dividers = [...document.querySelectorAll('.pane-divider__resize-hit-area')]
    .filter(shown).map(element => ({ key: element.closest('.sidebar-shell__divider') ? '侧栏分隔线' : '分栏分隔线', rect: box(element) }))
    .filter(({ rect }) => rect.top < headerBox.bottom && rect.bottom > headerBox.top);
  return {
    viewport: { width: innerWidth, height: innerHeight }, header: headerBox, dividers, elements,
    entry: pill ? (pill.classList.contains('is-compact') ? 'pill-compact' : 'pill') : elements.some(e => e.group === 'update') ? 'icon' : 'none',
  };
}`;

/**
 * 依次设好每档侧栏，等画面稳定再量；一次求值量完一组，省掉每档一次进程往返。
 * 连续两次测量不同就再等，量不稳本身就是问题（例如入口在完整和图标间来回切）。
 */
function measureSidebars(sidebars) {
  return `(async () => {
    const ui = ${rendererStore('ui')};
    const measure = ${measureSource};
    const results = [];
    for (const sidebar of ${JSON.stringify(sidebars)}) {
      ui.setSidebarVisible(sidebar !== null);
      if (sidebar !== null) ui.setSidebarWidth(sidebar);
      let settled = await ${settleExpression};
      let measured = measure();
      let stable = false;
      for (let attempt = 0; attempt < 3 && !stable; attempt += 1) {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const again = measure();
        stable = JSON.stringify(again) === JSON.stringify(measured);
        if (!stable) {
          settled = await ${settleExpression};
          measured = measure();
        }
      }
      results.push({ settled, stable, ...measured });
    }
    return results;
  })()`;
}

const label = ({ page, window, fullscreen, locale, update, sidebar }) =>
  `page=${page} window=${window} ${fullscreen ? 'fullscreen' : 'windowed'} locale=${locale} update=${update} sidebar=${sidebar ?? 'collapsed'}`;

/** 这些组合各留一张标题栏截图作证据：无论通过与否，人眼可以对照数值复核。 */
const evidenceShots = new Set([
  'page=conversation window=1400 windowed locale=zh-CN update=ready sidebar=collapsed',
  'page=conversation window=1400 windowed locale=zh-CN update=ready sidebar=200',
  'page=conversation window=1400 windowed locale=zh-CN update=ready sidebar=260',
  'page=conversation window=1400 windowed locale=en-US update=installing sidebar=260',
  'page=conversation window=1400 fullscreen locale=zh-CN update=ready sidebar=200',
  'page=conversation window=1400 windowed locale=zh-CN update=downloading sidebar=200',
  'page=document window=980 windowed locale=en-US update=installing sidebar=500',
  'page=document window=980 windowed locale=zh-CN update=ready sidebar=collapsed',
]);

async function openDocument(run) {
  const fixture = await run('fixture', 'project-overview');
  await run('open', fixture.projectId, '--overview');
  await run('wait', '--expr', `document.querySelectorAll('.project-overview__row').length === ${fixture.documents}`);
  const row = await run('eval', `[...document.querySelectorAll('.project-overview__row')].findIndex(row => row.innerText.includes('行业报告'))`);
  assert.ok(row.value >= 0, '概览里没有夹具文档');
  await run('click', `.project-overview__row:nth-child(${row.value + 1}) .project-overview__name`);
  await run('wait', '--selector', '.app-header-right .header-pane__title');
}

/**
 * 标题栏几何不变量扫描：按 HEADER_SCAN_MATRIX 逐组设条件、量矩形、判不变量。
 * 窗口尺寸与全屏走 Main：前者真实改窗口内容区，后者发出系统全屏事件，由产品自己的 Main 处理器通知 Renderer
 * （隐藏窗口不真的进入全屏，红绿灯按全屏时隐藏处理）。语言、侧栏走各自 store action，更新状态用 update-state 夹具。
 */
export async function headerScenario(test, evidence, { matrix = HEADER_SCAN_MATRIX } = {}) {
  const { run } = test;
  const { viteUrl } = await run('status');
  const mainWindow = `require('electron').BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().startsWith(${JSON.stringify(viteUrl)}))`;
  const rows = [];
  const failures = [];

  await evidence.check('标题栏各条件组合下互不重叠、不进拖动热区、可点击、文字认得出', async () => {
    for (const page of matrix.pages) {
      if (page === 'conversation') await run('open', 'assistant');
      else await openDocument(run);
      for (const window of matrix.windows) {
        await run('eval', '--main', `${mainWindow}.setContentSize(${window}, ${WINDOW_HEIGHT})`);
        await run('wait', '--expr', `innerWidth === ${window}`);
        for (const fullscreen of matrix.fullscreen) {
          await run('eval', '--main', `${mainWindow}.emit(${JSON.stringify(fullscreen ? 'enter-full-screen' : 'leave-full-screen')})`);
          await run('wait', '--expr', `document.querySelector('.app-header-left').classList.contains('mac-native') === ${!fullscreen}`);
          const buttons = fullscreen ? null : (await run('eval', '--main', `${mainWindow}.getWindowButtonPosition()`)).value;
          for (const locale of matrix.locales) {
            await run('eval', `${rendererStore('localization')}.setCurrentLocale(${JSON.stringify(locale)})`);
            for (const update of matrix.updates) {
              await run('fixture', 'update-state', update);
              const measurements = (await run('eval', measureSidebars(matrix.sidebars))).value;
              for (const [index, sidebar] of matrix.sidebars.entries()) {
                const conditions = { page, window, fullscreen, locale, update, sidebar };
                const name = label(conditions);
                const measured = measurements[index];
                const violations = checkHeaderInvariants({ ...measured, trafficLights: trafficLightsRect(buttons, measured.header) });
                if (!measured.stable) violations.push({ invariant: 'stable', elements: [], detail: '连续测量仍在变化' });
                const row = { conditions: name, entry: measured.entry, settled: measured.settled, violations,
                  elements: measured.elements.map(({ key, rect }) => ({ key, left: rect.left, right: rect.right })) };
                if (violations.length || evidenceShots.has(name)) {
                  // 回到这一档再截；证据目录按顺序给截图加前缀，用原文件名就能对回这组条件。
                  await run('eval', measureSidebars([sidebar]));
                  row.shot = basename((await run('shot', '--clip', `0,0,${window},40`)).artifacts[0].path);
                }
                rows.push(row);
                if (violations.length) failures.push({ conditions: name, violations, shot: row.shot });
              }
            }
          }
        }
      }
    }
    evidence.json('header-scan', { matrix, combinations: rows.length, failed: failures.length, rows });
    const report = failures.slice(0, 12).map(({ conditions, violations }) =>
      `${conditions}\n${violations.map(v => `  - [${v.invariant}] ${v.detail}`).join('\n')}`).join('\n');
    assert.equal(failures.length, 0, `${failures.length}/${rows.length} 组条件违反标题栏不变量：\n${report}`);
    return { combinations: rows.length };
  });
}
