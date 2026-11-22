import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { settleExpression } from '../../../development/features/desktop-probe/orchestration/probePage.mjs';
import { until } from './installedDesktopSession.mjs';
import { readNtfsAllocation } from './ntfsAllocation.mjs';

const plugin = 'knowledge';
const sidebar = '.sidebar-entry:has(svg[data-icon="library"])';
const install = '.plugin-store-install-button:not([disabled])';
const dialog = '.modal-overlay--alert';
const panel = '.plugin-data-panel';

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function assertDisplayedBytes(text, allocated, message) {
  const parts = text.match(/([\d,.]+) (B|KB|MB|GB|TB)$/u);
  assert.ok(parts, `${message}: no amount in ${text}`);
  const divisor = 1024 ** ['B', 'KB', 'MB', 'GB', 'TB'].indexOf(parts[2]);
  const shown = Number(parts[1].replaceAll(',', ''));
  const tolerance = parts[2] === 'B' ? 0 : 0.05;
  assert.ok(
    Math.abs(shown - allocated / divisor) <= tolerance + Number.EPSILON * shown,
    `${message}: ${text} does not match ${allocated} allocated bytes`
  );
}

export async function verifyWindowsPluginData({
  application,
  database,
  evidence,
  check,
  library,
  search,
  embeddingCalls,
  observations,
}) {
  const { evaluate } = application;
  observations.screenshotSettled = {};
  const shot = async name => {
    // 和通用探针一致，记录画面稳定性供截图复核；业务通过由可见状态和磁盘事实决定。
    observations.screenshotSettled[name] = await evaluate(settleExpression);
    await application.screenshot(path.join(evidence, `${name}.png`));
  };
  const click = selector =>
    application.clickElement(`document.querySelector(${JSON.stringify(selector)})`);
  const present = selector =>
    evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const waitFor = (selector, expected = true) =>
    until(
      () => present(selector),
      value => value === expected,
      selector,
      30_000
    );
  const text = selector =>
    evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? ''`);
  const getDetail = async () => {
    const result = await evaluate('window.electronAPI.plugins.getDetail("knowledge")');
    assert.equal(result.success, true, JSON.stringify(result.error));
    return result.data;
  };
  const screenshotState = async (status, name) => {
    await waitFor(`${panel} .is-${status}`);
    await waitFor(dialog, false);
    await shot(name);
  };
  const confirm = name =>
    application.clickElement(
      `[...document.querySelectorAll('${dialog} button')].find(el => el.textContent.trim() === ${JSON.stringify(name)})`
    );
  const entries = await evaluate('window.electronAPI.plugins.rendererEntries()');
  const active = entries.data.find(entry => entry.pluginId === plugin);
  assert.ok(active, 'Knowledge has an active artifact before lifecycle checks');
  const artifactRoot = path.dirname(active.pluginDir);
  const dataRoot = path.join(application.workspace, 'Plugins', plugin);
  const collectionRoot = path.join(dataRoot, 'qdrant', 'storage', 'collections', library.id);
  const manifest = JSON.parse(await readFile(path.join(active.pluginDir, 'plugin.json'), 'utf8'));
  // 原文由摄入 Worker 写入；向量服务未能启动而失败的上传只留失败记录、没有原文（如前面的端口占用用例）。
  // 记为 null 并照常比对：卸载与重装前后既不能凭空出现原文，也不能丢失已有原文。
  const sourceIdentity = async () =>
    Object.fromEntries(
      await Promise.all(
        library.documentIds.map(async id => {
          try {
            const bytes = await readFile(path.join(dataRoot, 'source_of_truth', `${id}.source.json`));
            return [id, createHash('sha256').update(bytes).digest('hex')];
          } catch (error) {
            if (error?.code === 'ENOENT') return [id, null];
            throw error;
          }
        })
      )
    );
  const persistedDocumentIds = () =>
    database
      .prepare('SELECT id FROM kb_documents WHERE kb_id=? ORDER BY id')
      .all(library.id)
      .map(row => row.id);
  const collectionIdentity = async () => {
    const files = await readdir(collectionRoot, { recursive: true, withFileTypes: true });
    const identities = await Promise.all(
      files
        .filter(entry => entry.isFile())
        .map(async entry => {
          const file = path.join(entry.parentPath, entry.name);
          const { size, mtimeMs } = await stat(file);
          return [path.relative(collectionRoot, file), size, mtimeMs];
        })
    );
    return identities.sort(([left], [right]) => left.localeCompare(right));
  };
  const facts = async () => ({
    installation: database
      .prepare(
        'SELECT installed, schema_version, user_removed FROM installed_plugins WHERE plugin_id=?'
      )
      .get(plugin),
    enabled: Boolean(
      database.prepare('SELECT 1 FROM enabled_plugins WHERE plugin_id=?').get(plugin)
    ),
    active:
      database
        .prepare('SELECT active_version, status FROM plugin_active_versions WHERE plugin_id=?')
        .get(plugin) ?? null,
    pointer: await readJsonIfPresent(path.join(artifactRoot, 'active.json')),
    markerExists: await exists(path.join(artifactRoot, '.user-removed.json')),
    artifactExists: await exists(active.pluginDir),
    migrations: database
      .prepare(
        'SELECT version, applied_at FROM plugin_migrations WHERE plugin_id=? ORDER BY version'
      )
      .all(plugin),
    ownedTables: database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map(row => row.name)
      .filter(name => manifest.ownedTables.includes(name)),
    cleanup:
      database
        .prepare('SELECT status, error_code FROM plugin_cleanup_jobs WHERE plugin_id=?')
        .get(plugin) ?? null,
  });
  const requireUninstalled = state => {
    assert.equal(state.installation.installed, 0);
    assert.equal(state.installation.user_removed, 1);
    assert.equal(state.enabled, false);
    assert.equal(state.active, null);
    assert.equal(state.pointer, null);
    assert.equal(state.markerExists, true);
    assert.equal(state.artifactExists, false);
    assert.equal(state.cleanup, null);
  };
  const reinstall = async () => {
    await click(install);
    await waitFor(sidebar);
    await until(
      getDetail,
      value => value.state === 'enabled',
      'Reinstalled knowledge is enabled',
      30_000
    );
    const state = await facts();
    assert.equal(state.installation.installed, 1);
    assert.equal(state.installation.user_removed, 0);
    assert.equal(state.enabled, true);
    assert.equal(state.active?.status, 'active');
    assert.equal(state.active.active_version, manifest.version);
    assert.ok(state.pointer);
    assert.equal(state.markerExists, false);
    assert.equal(state.artifactExists, true);
    return state;
  };
  const verifyAllocation = async (status, name) => {
    const measured = await readNtfsAllocation(dataRoot);
    // 占用走后台计算；旧缓存过期时首次读详情只会安排统计，不会同步返回数值。
    const detail = await until(
      getDetail,
      value => value.data !== undefined,
      'Fresh store allocation',
      20_000
    );
    const data = detail.data;
    observations[name] = { measured, reported: data };
    assert.equal(data?.status, status);
    assert.equal(
      data.bytes,
      measured.wholeBlockTotal,
      'Store raw usage vs. Win32 whole-block allocation'
    );
    for (const [category, bytes] of Object.entries(measured.wholeBlockBytes))
      assert.equal(
        data.directories[category],
        bytes,
        `Store ${category} usage vs. Win32 allocation`
      );
    if (status !== 'empty') {
      const displayed = await text(`${panel} .plugin-data-panel__total`);
      assertDisplayedBytes(displayed, measured.wholeBlockTotal, name);
      observations[name].displayed = displayed;
      const rows = await evaluate(
        `Array.from(document.querySelectorAll('${panel} .plugin-data-panel__row'), el => el.querySelector('dd').textContent.trim())`
      );
      assert.equal(rows.length, 3);
      for (const [index, category] of ['source', 'derived', 'runtime'].entries())
        assertDisplayedBytes(rows[index], measured.wholeBlockBytes[category], category);
      observations[name].displayedCategories = rows;
    }
    return measured.total;
  };

  await application.clickText('插件');
  await application.clickElement(
    '[...document.querySelectorAll(".plugin-store-card")].find(el => el.querySelector("h2")?.textContent.trim() === "知识库")'
  );

  let initial;
  let originalSources;
  let oldCollection;
  await check('Windows商店卸载默认保留：移除运行产物但保留资料与迁移记录', async () => {
    await waitFor(`${panel} .is-installed`);
    initial = await facts();
    assert.ok(initial.migrations.length > 0);
    originalSources = await sourceIdentity();
    assert.ok(Object.values(originalSources).some(Boolean), 'Retained library has ingested sources to protect');
    await click('.plugin-store-uninstall-button');
    await waitFor(`${dialog} .plugin-store-uninstall-dialog input[type="checkbox"]`);
    assert.equal(await present(`${dialog} input[type="checkbox"]:checked`), false);
    await shot('uninstall-retain-confirm');
    await confirm('卸载');
    await waitFor(sidebar, false);
    await screenshotState('retained', 'uninstalled-retained');
    const retained = await facts();
    observations.retained = retained;
    requireUninstalled(retained);
    assert.deepEqual(retained.migrations, initial.migrations);
    assert.deepEqual(persistedDocumentIds(), [...library.documentIds].sort());
    assert.deepEqual(await sourceIdentity(), originalSources);
    oldCollection = await collectionIdentity();
    assert.ok(oldCollection.length > 0, 'Real Qdrant collection files remain');
  });
  await check('NTFS保留占用按Win32实际分配字节核对，分类与前端文本一致', async () => {
    assert.ok((await verifyAllocation('retained', 'retainedAllocation')) > 0);
  });
  await check('Windows商店随包重装默认启用、迁移未重跑、检索复用原索引', async () => {
    const before = embeddingCalls();
    assert.ok(before > 0, 'Embedding request recorder observed real ingestion and search');
    const installed = await reinstall();
    observations.reinstalledRetained = installed;
    assert.deepEqual(installed.migrations, initial.migrations);
    assert.deepEqual(persistedDocumentIds(), [...library.documentIds].sort());
    assert.deepEqual(await sourceIdentity(), originalSources);
    assert.deepEqual(await collectionIdentity(), oldCollection);
    assert.equal(embeddingCalls(), before, 'Reinstall must not re-embed retained documents');
    const matches = await search(library.searchDocumentId);
    assert.ok(matches.results.some(item => item.docId === library.searchDocumentId));
    assert.equal(
      embeddingCalls(),
      before + 1,
      'Only the query, not the retained documents, is embedded'
    );
    await screenshotState('installed', 'reinstalled-retained');
  });

  await check('Windows商店卸载并删除：清理文件与SQLite，重装得到空库', async () => {
    await click('.plugin-store-uninstall-button');
    await click(`${dialog} .plugin-store-uninstall-dialog label`);
    await waitFor(`${dialog} .plugin-store-uninstall-dialog__details`);
    await shot('uninstall-delete-confirm');
    await confirm('卸载并删除');
    await waitFor(sidebar, false);
    await screenshotState('empty', 'uninstalled-empty');
    observations.completionMessage = await until(
      () =>
        evaluate(
          String.raw`document.body.innerText.match(/知识库 已卸载，已释放 [\d,.]+ (?:B|KB|MB|GB|TB)/u)?.[0] ?? ''`
        ),
      Boolean,
      'Plugin store reports space released',
      5_000
    );
    assert.doesNotMatch(observations.completionMessage, /已释放 0 B$/u);
    await shot('storage-released');
    const removed = await facts();
    observations.removed = removed;
    requireUninstalled(removed);
    assert.equal(removed.installation.schema_version, 0);
    assert.deepEqual(removed.migrations, []);
    assert.deepEqual(removed.ownedTables, []);
    for (const relative of Object.values(manifest.dataStorage.directories).flat())
      assert.equal(await exists(path.join(dataRoot, relative)), false, `Cleanup left ${relative}`);
    assert.equal(await verifyAllocation('empty', 'deletedAllocation'), 0);
    const fresh = await reinstall();
    observations.reinstalledEmpty = fresh;
    assert.ok(fresh.migrations.length > 0);
    assert.deepEqual(fresh.ownedTables, [...manifest.ownedTables].sort());
    assert.equal(
      (await application.plugin('list')).some(item => item.id === library.id),
      false
    );
    assert.equal(database.prepare('SELECT count(*) AS count FROM kb_documents').get().count, 0);
    assert.equal(await exists(collectionRoot), false);
    assert.deepEqual(
      database
        .prepare('PRAGMA quick_check')
        .all()
        .map(row => row.quick_check),
      ['ok']
    );
    await screenshotState('empty', 'reinstalled-empty');
  });

  await check('Windows NTFS 文件被占用：清理显示残留，阻止重装，释放后可在详情页重试', async () => {
    const source = path.join(dataRoot, 'source_of_truth');
    await mkdir(source, { recursive: true });
    const target = path.join(source, 'windows-e7-owned-lock.txt');
    const bytes = 'Synthetic retained source held by an ordinary user.\n'.repeat(1024);
    await writeFile(target, bytes, { flag: 'wx' });
    // 只锁本轮新建文件。允许读和分配量测量，但显式拒绝共享删除，区别于 ACL 权限不足。
    const script = `$ErrorActionPreference='Stop'; $handle=[IO.File]::Open('${target.replaceAll("'", "''")}', 'Open', 'Read', 'Read'); try { [Console]::WriteLine('LOCKED'); [void][Console]::ReadLine() } finally { $handle.Dispose() }`;
    const holder = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    holder.stdout.on('data', chunk => { stdout += chunk; });
    holder.stderr.on('data', chunk => { stderr += chunk; });
    const exit = new Promise((resolve, reject) => {
      holder.once('error', reject);
      holder.once('close', resolve);
    });
    void exit.catch(() => {});
    try {
      await until(() => {
        assert.equal(holder.exitCode, null, stderr);
        return stdout.includes('LOCKED');
      }, Boolean, 'NTFS lock held by a real Windows file handle', 15_000);
      // 先退出详情再进入，让原文的独立夹具被新的占用采样发现。
      await click('.plugin-store-back-button');
      await application.clickElement(
        '[...document.querySelectorAll(".plugin-store-card")].find(el => el.querySelector("h2")?.textContent.trim() === "知识库")'
      );
      await waitFor(`${panel} .is-installed`);
      await click('.plugin-store-uninstall-button');
      await click(`${dialog} .plugin-store-uninstall-dialog label`);
      await confirm('卸载并删除');
      await screenshotState('failed', 'ntfs-file-locked');
      const locked = await facts();
      observations.lockedSource = { ...locked, message: await text(`${panel} .plugin-data-panel__reason`) };
      assert.equal(locked.installation.installed, 0);
      assert.equal(locked.installation.user_removed, 1);
      assert.equal(locked.cleanup?.status, 'failed');
      assert.equal(locked.cleanup?.error_code, 'file-locked');
      assert.match(observations.lockedSource.message, /占用/u);
      assert.equal(await readFile(target, 'utf8'), bytes);
      assert.equal(await present(install), false);
    } finally {
      holder.stdin.end('\n');
      assert.equal(await exit, 0, stderr);
    }
    await application.clickElement(`Array.from(document.querySelectorAll('${panel} button')).find(button => button.textContent.trim() === '重试')`);
    await screenshotState('empty', 'ntfs-file-lock-released');
    requireUninstalled(await facts());
    assert.equal(await exists(target), false);
    assert.equal(await verifyAllocation('empty', 'lockRetryAllocation'), 0);
    await reinstall();
    await screenshotState('empty', 'ntfs-file-lock-reinstalled');
  });
}
