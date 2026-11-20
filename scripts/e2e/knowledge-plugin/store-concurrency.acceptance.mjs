import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { installKnowledgeForScenario } from './knowledgeStore.fixture.mjs';

process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence('plugin-store-concurrency', {
  files: ['scripts/e2e/knowledge-plugin/store-concurrency.acceptance.mjs'],
});
const test = acceptance(`plugin-store-concurrency-${process.pid}`, { evidence });
const { run } = test;
const labels = ['知识库', 'Slides'];
const sidebar = '.sidebar-entry:has(svg[data-icon="library"])';
let db;
let failed;

const evalPage = async code => (await run('eval', code)).value;
async function activate(role, label, within) {
  const { entries } = await run(
    'snapshot',
    '--json',
    '--role',
    role,
    '--within',
    within,
    '--max-lines',
    '120'
  );
  const matches = entries.filter(entry => entry.name === label);
  assert.equal(matches.length, 1, `${role}: ${label}`);
  await run('click', matches[0].ref);
}

function checkState(installed, enabled) {
  const rows = db
    .prepare(
      `
    SELECT p.plugin_id,p.installed,p.user_removed,(e.plugin_id IS NOT NULL) enabled,a.status active
    FROM installed_plugins p LEFT JOIN enabled_plugins e USING(plugin_id)
    LEFT JOIN plugin_active_versions a USING(plugin_id)
    WHERE p.plugin_id IN ('knowledge','slides') ORDER BY p.plugin_id
  `
    )
    .all();
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.installed, installed);
    assert.equal(row.enabled, enabled);
    assert.equal(row.user_removed, 1 - installed);
    assert.equal(row.active, installed ? 'active' : null);
  }
  return rows;
}

const cards = `const cards = ${JSON.stringify(labels)}.map(label => [...document.querySelectorAll('.plugin-store-card')].find(card => card.querySelector('h2')?.textContent.trim()===label));`;
function waitCards(selector) {
  return run(
    'wait',
    '--expr',
    `(()=>{${cards}return cards.every(card=>card?.querySelector(${JSON.stringify(selector)}));})()`
  );
}

async function clickPair(selector) {
  // 同一轮发出两个真实商店控件事件，经过 Vue、Preload、Backend；不假装是两个窗口。
  const clicked = await evalPage(
    `(()=>{${cards}const buttons=cards.map(card=>card?.querySelector(${JSON.stringify(selector)}));if(buttons.some(button=>!button||button.disabled))return false;buttons.forEach(button=>button.click());return true;})()`
  );
  assert.equal(clicked, true, selector);
}

try {
  const up = await run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
  await installKnowledgeForScenario(run);
  db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  await activate('button', '插件', 'aside');
  await waitCards('input[type=checkbox]:checked');
  await evidence.check('两个插件并发停用、并发启用，运行注册表与商店一致', async () => {
    await clickPair('input[type="checkbox"]');
    await waitCards('input[type=checkbox]:not(:checked):not(:disabled)');
    await run('wait', '--selector', sidebar, '--state', 'detached');
    evidence.json('parallel-disabled', checkState(1, 0));
    await run('shot');
    await clickPair('input[type="checkbox"]');
    await waitCards('input[type=checkbox]:checked:not(:disabled)');
    await run('wait', '--selector', sidebar);
    evidence.json('parallel-enabled', checkState(1, 1));
    await run('shot');
  });

  await evidence.check('重复触发卸载确认只收尾一次，两个随包插件可并发重装', async () => {
    for (const label of labels) {
      await activate('heading', label, 'main');
      await activate('button', '卸载', 'main');
      await run('wait', '--selector', '.modal-overlay--alert .alert-dialog-footer button');
      const didClick = await evalPage(
        `(()=>{const buttons=[...document.querySelectorAll('.modal-overlay--alert .alert-dialog-footer button')];const button=buttons.find(node=>['卸载','确定'].includes(node.textContent.trim()));if(!button)return false;button.click();button.click();return true;})()`
      );
      assert.equal(didClick, true);
      await run('wait', '--selector', '.modal-overlay--alert', '--state', 'detached');
      await run('wait', '--selector', '.plugin-store-install-button:not([disabled])');
      await run('shot');
      await run('click', '--selector', '.plugin-store-back-button');
    }
    evidence.json('after-double-uninstall-confirmation', checkState(0, 0));
    await run('click', 'text=插件市场');
    await waitCards('.plugin-store-install-button:not([disabled])');
    await clickPair('.plugin-store-install-button');
    // 安装完成的卡片会离开市场；两个卡片都移走后再回到已有插件核对运行状态。
    await run('wait', '--expr', `(()=>{${cards}return cards.every(card=>!card);})()`);
    await run('click', 'text=已有插件');
    await waitCards('input[type=checkbox]:checked:not(:disabled)');
    await run('wait', '--selector', sidebar);
    evidence.json('parallel-reinstalled', checkState(1, 1));
    await run('shot');
  });
} catch (error) {
  failed = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  db?.close();
  try {
    evidence.json('teardown', await test.finish({ clean: !failed }));
  } catch (error) {
    failed ??= error;
    evidence.error(error);
  }
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
