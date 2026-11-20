import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';

const mode = process.argv[2];
const modes = [
  'during-migration',
  'before-pointer',
  'after-pointer',
  'automatic-upgrade',
  'rejected-migration',
  'removed-before-upgrade',
];
assert.ok(modes.includes(mode), `Specify one upgrade case: ${modes.join(', ')}`);
const repo = realpathSync(fileURLToPath(new URL('../../..', import.meta.url)));
const scratch = realpathSync(dirname(repo));
assert.match(basename(scratch), /^linnya-knowledge-upgrade\.[\w]+$/u);
assert.equal(
  dirname(scratch),
  realpathSync(tmpdir()),
  'Upgrade may replace artifacts only in a disposable checkout'
);
assert.ok(
  readFileSync(join(repo, '.git'), 'utf8').startsWith('gitdir: '),
  'Expected a linked checkout'
);
const bundledRoot = join(repo, 'extraResources', 'plugins');
const bundled = join(bundledRoot, 'knowledge');
const old = JSON.parse(readFileSync(join(bundled, 'plugin.json'), 'utf8'));
const versions = old.version.split('.').map(Number);
assert.equal(versions.length, 3);
assert.ok(versions.every(Number.isSafeInteger));
const newer = [versions[0], versions[1], versions[2] + 1].join('.');
const precise = ['during-migration', 'before-pointer', 'after-pointer'].includes(mode);
const library = 'E7 library from the older bundled version';
const sidebar = '.sidebar-entry:has(svg[data-icon="library"])';

process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence(`knowledge-upgrade-${mode}`, {
  files: [
    'scripts/e2e/knowledge-plugin/upgrade-checkpoint.acceptance.mjs',
    'scripts/e2e/knowledge-plugin/upgrade-checkpoint.fixture.ts',
  ],
});
const test = acceptance(`knowledge-upgrade-checkpoint-${process.pid}`, { evidence });
const { run } = test;
const start = () => run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
let savedArtifact;
let replacementArchive;
let failed;

async function click(role, name, within) {
  const { entries } = await run(
    'snapshot',
    '--json',
    '--role',
    role,
    '--max-lines',
    '120',
    '--within',
    within
  );
  const results = entries.filter(entry => entry.name === name);
  assert.equal(results.length, 1, `Expected one ${role}: ${name}`);
  await run('click', results[0].ref);
}

async function openDetail({ market = false } = {}) {
  await click('button', '插件', 'aside');
  if (market) await run('click', 'text=插件市场');
  await click('heading', '知识库', 'main');
}

function optional(read) {
  try {
    return read();
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function facts(up, file) {
  const db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const plugin = join(up.root, 'plugins', 'knowledge');
  try {
    return {
      installed: db
        .prepare(
          "SELECT installed,version,schema_version,user_removed FROM installed_plugins WHERE plugin_id='knowledge'"
        )
        .get(),
      enabled: Boolean(
        db.prepare("SELECT 1 FROM enabled_plugins WHERE plugin_id='knowledge'").get()
      ),
      active:
        db
          .prepare(
            "SELECT active_version,previous_version,status FROM plugin_active_versions WHERE plugin_id='knowledge'"
          )
          .get() ?? null,
      pointer: optional(() => JSON.parse(readFileSync(join(plugin, 'active.json'), 'utf8'))),
      removed: optional(() => JSON.parse(readFileSync(join(plugin, '.user-removed.json'), 'utf8'))),
      migrations: db
        .prepare(
          "SELECT version,applied_at FROM plugin_migrations WHERE plugin_id='knowledge' ORDER BY version"
        )
        .all(),
      libraries: db.prepare('SELECT id,name FROM knowledge_bases ORDER BY id').all(),
      column: Boolean(
        db
          .prepare(
            "SELECT name FROM pragma_table_info('knowledge_bases') WHERE name='e7_checkpoint'"
          )
          .get()
      ),
      source: readFileSync(file, 'utf8'),
      integrity: db.prepare('PRAGMA quick_check').get().quick_check,
    };
  } finally {
    db.close();
  }
}

function makeNewerBundledArtifact(up) {
  assert.equal(up.repoRoot, repo);
  savedArtifact = join(up.root, 'older-bundled-knowledge');
  replacementArchive = join(up.root, 'newer-bundled-knowledge');
  renameSync(bundled, savedArtifact);
  cpSync(savedArtifact, bundled, { recursive: true });
  const backendManifest = './dist/backend/upgrade-e7.cjs';
  assert.equal(old.entry.backend, './dist/backend/index.cjs');
  writeFileSync(
    join(bundled, backendManifest),
    `
const original = require('./index.cjs').default;
exports.backendPlugin = {
  ...original,
  meta: { ...original.meta, version: ${JSON.stringify(newer)} },
  pluginMigrations: [...original.pluginMigrations, {
    version: 2,
    description: 'Synthetic E7 migration of the real knowledge plugin',
    up(db) {
      db.exec('ALTER TABLE knowledge_bases ADD COLUMN e7_checkpoint INTEGER NOT NULL DEFAULT 1');
      ${mode === 'rejected-migration' ? "throw new Error('E7 deliberately rejected migration');" : ''}
    }
  }],
};
`,
    { flag: 'wx' }
  );
  writeFileSync(
    join(bundled, 'plugin.json'),
    JSON.stringify({
      ...old,
      version: newer,
      entry: { ...old.entry, backend: backendManifest },
      migrations: [
        ...old.migrations,
        { version: 2, description: 'Synthetic E7 migration of the real knowledge plugin' },
      ],
    })
  );
  const checksum = readdirSync(bundled, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && entry.name !== 'SHA512SUMS')
    .map(entry => join(entry.parentPath, entry.name))
    .sort()
    .map(
      file =>
        `${createHash('sha512').update(readFileSync(file)).digest('hex')}  ${relative(bundled, file)}`
    )
    .join('\n');
  writeFileSync(join(bundled, 'SHA512SUMS'), `${checksum}\n`);
  evidence.json('bundled-versions', {
    old: old.version,
    newer,
    checksum,
    temporaryCandidate: true,
  });
}

function assertNewVersion(state, initial, checkpoint) {
  assert.equal(state.installed.version, newer);
  assert.equal(state.installed.installed, 1);
  assert.equal(state.enabled, true);
  assert.equal(state.installed.user_removed, 0);
  assert.equal(state.installed.schema_version, 2);
  assert.equal(state.removed, null);
  assert.equal(state.active.status, 'active');
  assert.equal(state.active.active_version, newer);
  assert.equal(state.pointer.version, newer);
  const previous = mode === 'removed-before-upgrade' ? null : old.version;
  assert.equal(state.active.previous_version, previous);
  assert.equal(state.pointer.previousVersion ?? null, previous);
  assert.deepEqual(
    state.migrations.map(row => row.version),
    [1, 2]
  );
  assert.deepEqual(state.migrations[0], initial.migrations[0]);
  if (checkpoint?.column)
    assert.deepEqual(
      state.migrations[1],
      checkpoint.migrations[1],
      'A committed migration must not run again'
    );
  assert.equal(state.column, true);
}

try {
  await evidence.check(`新随包版本 ${mode}：激活、迁移、原资料及界面一致`, async () => {
    const up = await start();
    await run('wait', '--selector', sidebar);
    await run('click', '--selector', sidebar);
    await run('wait', '--text', '新建知识库');
    await click('button', '新建知识库', '.kb-list-header');
    await run('click', '--selector', '#new-kb-name');
    await run('type', library);
    await click('button', '创建', '.modal-overlay');
    await run('wait', '--text', library);
    await run('shot');
    const file = join(
      up.root,
      'workspace',
      'Plugins',
      'knowledge',
      'source_of_truth',
      'e7-existing-source.txt'
    );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'existing pre-upgrade content', { flag: 'wx' });
    if (mode === 'removed-before-upgrade') {
      await openDetail();
      await run('wait', '--selector', '.plugin-data-panel .is-installed');
      await click('button', '卸载', 'main');
      await click('button', '卸载', '.modal-overlay--alert');
      await run('wait', '--selector', sidebar, '--state', 'detached');
      await run('shot');
    }
    await run('stop');
    const initial = facts(up, file);
    assert.equal(initial.installed.version, old.version);
    assert.deepEqual(
      initial.migrations.map(row => row.version),
      [1]
    );
    assert.ok(initial.libraries.some(item => item.name === library));
    evidence.json('older-version-state', initial);
    makeNewerBundledArtifact(up);

    let checkpoint;
    if (precise) {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('./upgrade-checkpoint.fixture.ts', import.meta.url)),
          mode,
          up.root,
          up.workspaceDb,
          bundledRoot,
        ],
        { cwd: repo, timeout: 20_000, encoding: 'utf8' }
      );
      assert.equal(
        result.signal,
        'SIGKILL',
        result.stderr || result.error?.message || result.stdout
      );
      const trap = JSON.parse(readFileSync(join(up.root, 'upgrade-checkpoint.json'), 'utf8'));
      checkpoint = facts(up, file);
      evidence.json('immediate-recovery-facts', { trap, checkpoint });
      assert.equal(trap.mode, mode);
      assert.equal(trap.inTransaction, mode === 'during-migration');
      if (mode === 'during-migration') assert.deepEqual(checkpoint, initial);
      else {
        assert.equal(checkpoint.installed.version, newer);
        assert.equal(checkpoint.installed.schema_version, 2);
        assert.equal(checkpoint.active.status, 'activating');
        assert.equal(checkpoint.pointer.version, mode === 'before-pointer' ? old.version : newer);
      }
    }

    const restarted = await start();
    assert.equal(restarted.workspaceDb, up.workspaceDb);
    let state = facts(restarted, file);
    evidence.json('new-desktop-state', state);
    await openDetail({ market: mode === 'removed-before-upgrade' });
    await run('shot');
    if (mode === 'removed-before-upgrade') {
      assert.equal(state.installed.installed, 0);
      assert.equal(state.installed.user_removed, 1);
      assert.equal(state.pointer, null);
      assert.deepEqual(state.migrations, initial.migrations);
      await run('wait', '--selector', sidebar, '--state', 'detached');
      await click('button', '安装', 'main');
      await run('wait', '--selector', sidebar);
      state = facts(restarted, file);
      evidence.json('explicit-reinstall-state', state);
    }
    if (mode === 'rejected-migration') {
      assert.equal(state.pointer?.version, old.version);
      assert.deepEqual(state.migrations, initial.migrations);
      assert.equal(state.column, false);
      assert.equal(
        state.installed.version,
        old.version,
        'The store must not record an installed version whose migration failed'
      );
    } else assertNewVersion(state, initial, checkpoint);
    assert.equal(state.integrity, 'ok');
    assert.deepEqual(state.libraries, initial.libraries);
    assert.equal(state.source, initial.source);
    await run('wait', '--selector', sidebar);
    await run('click', '--selector', sidebar);
    await run('wait', '--text', library);
    await run('shot');
  });
} catch (error) {
  failed = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  try {
    await run('stop');
    if (savedArtifact) {
      if (optional(() => readdirSync(bundled))) renameSync(bundled, replacementArchive);
      renameSync(savedArtifact, bundled);
    }
    evidence.json('teardown', await test.finish({ clean: !failed }));
  } catch (error) {
    failed ??= error;
    evidence.error(error);
  }
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
