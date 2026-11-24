import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { startDevPluginCatalog } from '../plugin-remote/devPluginCatalog.fixture.mjs';
import { clickNamed, knowledgeCatalog, knowledgeSidebar, openKnowledgeStoreDetail } from './knowledgeStore.fixture.mjs';

// 夹具的服务不限速；各服务共用同一输出目录，换成限速服务前先停掉。
knowledgeCatalog.stop();
// 知识库运行时约 25 MB，这个速度下要下载数分钟，退出一定落在下载途中。
const slowCatalog = await startDevPluginCatalog({ plugin: 'knowledge', throttleKbps: 512 });
process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence('plugin-quit-during-install', {
  files: ['scripts/e2e/knowledge-plugin/quit-during-install.acceptance.mjs'],
});
const test = acceptance(`plugin-quit-during-install-${process.pid}`, { evidence });
const { run } = test;
let failed;

const stagingLeft = root => ['plugins', join('user-data', 'runtimes')].flatMap(area => {
  const directory = join(root, area);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true }).map(String).filter(entry => /(^|[\\/])\.install-[^\\/]+$/u.test(entry));
});

try {
  const up = await run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
  await openKnowledgeStoreDetail(run, true);
  await clickNamed(run, 'button', '安装', 'main');
  await run('wait', '--expr', "[...document.querySelectorAll('main [role=progressbar]')].length > 0");
  await run('shot');
  await evidence.check('下载途中退出：后台正常关停，不留临时文件', async () => {
    assert.equal(stagingLeft(up.root).length, 1, 'the download must be in progress');
    const { desktopLog } = await run('status').then(status => ({ desktopLog: status.logs.desktop }));
    const startedAt = Date.now();
    await run('stop');
    const log = readFileSync(desktopLog, 'utf8');
    evidence.json('stop', { elapsedMs: Date.now() - startedAt, staging: stagingLeft(up.root) });
    assert.match(log, /插件下载已停止/u);
    assert.match(log, /服务已完全停止/u);
    assert.doesNotMatch(log, /未正常关停|未完整收口/u);
    assert.deepEqual(stagingLeft(up.root), []);
  });
  slowCatalog.stop();

  await evidence.check('重新打开后可以正常装好', async () => {
    await startDevPluginCatalog({ plugin: 'knowledge' });
    await run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
    await openKnowledgeStoreDetail(run, true);
    await clickNamed(run, 'button', '安装', 'main');
    await run('wait', '--selector', knowledgeSidebar);
    await run('shot');
  });
} catch (error) {
  failed = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  try {
    evidence.json('teardown', await test.finish({ clean: !failed }));
  } catch (error) {
    failed ??= error;
    evidence.error(error);
  }
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
