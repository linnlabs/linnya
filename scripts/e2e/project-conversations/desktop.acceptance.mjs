import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { relative, isAbsolute } from 'node:path';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { repoRoot } from '../../development/features/desktop-probe/definitions/probeContract.mjs';

const exec = promisify(execFile);
const evidence = createEvidence('project-conversation-query', { files: [
  'scripts/e2e/project-conversations/desktop.acceptance.mjs',
  'scripts/e2e/project-conversations/seedConversationFacts.ts',
  'src/app-hosts/linnya/application/project-conversations/__tests__/projectConversations.integration.test.ts',
  'src/app-hosts/linnya/application/conversation-activity/__tests__/conversationActivity.integration.test.ts',
  'src/app-hosts/linnya/application/plugin-cli-shell-bridge/__tests__/pluginCliShellBridge.integration.test.ts',
] });
const test = acceptance(`conversation-query-${process.pid}`, { evidence });
const { run } = test;
const rowIds = `[...document.querySelectorAll('.project-conversations__row')].map(row => row.dataset.conversationId)`;
const defaults = { query: '', agent: null, activity: 'any', documents: 'any', sort: 'activity', direction: 'desc' };
let failed;
let projectId;
let otherProject;
let up;
try {
  up = await run('up', '--size', '1400x900', '--mode', 'dev');
  evidence.json('candidate', { gitHead: up.gitHead, build: up.build, viewport: up.viewport });
  const cli = async (...args) => {
    const { stdout } = await exec('pnpm', ['-s', 'linnya:cli', ...args], {
      cwd: repoRoot, env: { ...process.env, LINNYA_CLI_CONNECTION_FILE: up.connectionFile }, timeout: 30000,
    });
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  projectId = (await cli('projects', 'create', '对话查询验收')).project.project_id;
  otherProject = (await cli('projects', 'create', '范围外项目')).project.project_id;
  // 夹具只写本次新建的探针临时数据库，绝不解析或写入日常开发目录。
  const inside = relative(up.root, up.workspaceDb);
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
  const db = new DatabaseSync(up.workspaceDb);
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN');
    const now = Date.now();
    for (const [id, project, title, offset, pinned, selected] of [
      ['query-a', projectId, '报价甲', 0, 0, null],
      ['query-b', projectId, '报价乙', 8, 1, 'research_v1'],
      ['query-empty', projectId, '尚未回复', 40, 0, 'research_v1'],
      ['query-private', otherProject, '范围外秘密', 0, 0, null],
    ]) {
      db.prepare('INSERT INTO conversations (conversation_id, project_id, title, created_at, last_event_at, is_pinned, selected_agent_id, user_message_count) VALUES (?, ?, ?, 1, ?, ?, ?, ?)')
        .run(id, project, title, now - offset * 86400000, pinned, selected, id === 'query-empty' ? 0 : 2);
      if (id === 'query-empty') continue;
      db.prepare(`INSERT INTO runs (id, conversation_id, kind, status, agent_spec_id, start_ts, updated_ts, metadata_json) VALUES (?, ?, 'agent', 'cancelled', ?, 1, 2, ?)`)
        .run(`run-${id}`, id, id === 'query-a' ? 'research_v1' : 'default', JSON.stringify({ lane: 'foreground' }));

    }
    db.prepare(`INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, created_at, updated_at) VALUES ('query-document', ?, NULL, 'document', '报价记录.md', 1, 1)`).run(projectId);
    db.prepare(`INSERT INTO action_ledger_entries (recorded_at, project_id, document_id, document_type, action, granularity, actor_kind, conversation_id, run_id, root_run_id, agent_id)
      VALUES (?, ?, 'query-document', 'document', 'create', 'coarse', 'run', 'query-a', 'run-query-a', 'run-query-a', 'research_v1')`).run(now, projectId);
    db.exec('COMMIT');
  } finally { db.close(); }
  await exec('pnpm', ['exec', 'tsx', 'scripts/e2e/project-conversations/seedConversationFacts.ts', up.root, up.workspaceDb], { cwd: repoRoot, timeout: 30000 });

  const hostQuery = async options => (await run('eval', `(async () => {
    const api = await import('/apps/renderer/domains/workspace/features/project-overview/infrastructure/projectConversationsGateway.ts');
    return api.queryProjectConversations(${JSON.stringify(projectId)}, ${JSON.stringify({ ...defaults, ...options })});
  })()`)).value;
  async function compare(options, expectedIds) {
    const result = await hostQuery(options);
    const expected = result.conversations.map(row => row.conversation_id);
    if (expectedIds) assert.deepEqual(expected, expectedIds);
    await run('wait', '--expr', `JSON.stringify(${rowIds}) === ${JSON.stringify(JSON.stringify(expected))}`);
    assert.deepEqual((await run('eval', rowIds)).value, expected);
    assert.ok(!expected.includes('query-private'));
    evidence.json('host-panel-comparison', { options, expected, activity: result.activities });
  }
  async function filter(index, label) {
    await run('click', '--selector', `.project-conversations .project-overview-filter:nth-of-type(${index}) .project-overview-filter__trigger`);
    await run('click', `text=${label}`);
  }
  await evidence.check('打开项目对话页，置顶顺序、项目隔离与中断事实正确', async () => {
    await run('open', projectId, '--overview');
    await run('click', '--selector', '.project-overview__pages [role="tab"]:nth-child(2)');
    await compare({}, ['query-b', 'query-a', 'query-empty']);
    assert.equal((await hostQuery({})).activities['query-a'].reason, 'cancelled');
    await run('shot', '--selector', '.project-overview');
  });
  await evidence.check('Agent按实际回复者筛选，已选但没回复不冒认；与Host同序', async () => {
    await filter(1, '研究');
    await compare({ agent: 'research_v1' }, ['query-a']);
    await run('shot', '--selector', '.project-overview');
    await filter(1, '全部 Agent');
  });
  await evidence.check('活动、文档与内容搜索组合和清除后恢复', async () => {
    await filter(2, '今天');
    await filter(3, '改过文档');
    await run('type', '可读回答', '.project-conversations input[type="search"]');
    await compare({ activity: 'today', documents: 'changed', query: '可读回答' }, ['query-a']);
    await run('shot', '--selector', '.project-overview');
    await run('click', '--selector', '.project-conversations input[type="search"]');
    await run('press', 'Meta+A');
    await run('press', 'Backspace');
    await filter(2, '不限时间');
    await filter(3, '没改文档');
    await compare({ documents: 'unchanged' }, ['query-b', 'query-empty']);
    await filter(3, '不限');
  });
  await evidence.check('五种CLI支持排序与面板相同，Agent展示名排序仍可操作', async () => {
    for (const [sort, index, first] of [['title', 1, 'asc'], ['turns', 3, 'desc'], ['documents', 4, 'desc'], ['activity', 5, 'desc'], ['storage', 6, 'desc']]) {
      await run('click', '--selector', `.project-conversations [role="columnheader"]:nth-child(${index}) button`);
      await compare({ sort, direction: first });
      await run('click', '--selector', `.project-conversations [role="columnheader"]:nth-child(${index}) button`);
      await compare({ sort, direction: first === 'asc' ? 'desc' : 'asc' });
    }
    await run('click', '--selector', '.project-conversations [role="columnheader"]:nth-child(2) button');
    await run('wait', '--expr', `${rowIds}.length === 3`);
    await run('shot', '--selector', '.project-overview');
  });
  await evidence.check('切换项目不会带入旧结果，无Renderer错误', async () => {
    await run('open', otherProject, '--overview');
    await run('click', '--selector', '.project-overview__pages [role="tab"]:nth-child(2)');
    await run('wait', '--expr', `JSON.stringify(${rowIds}) === '["query-private"]'`);
    const logs = await run('logs', '--level', 'error');
    assert.equal(logs.total, 0, JSON.stringify(logs.entries));
  });
} catch (error) {
  failed = error;
  if (!evidence.data.checks.some(check => check.status === 'failed')) evidence.error(error);
  try { await run('shot'); } catch (captureError) { evidence.error(captureError); }
} finally {
  try { evidence.json('cleanup', await test.finish({ clean: !failed })); }
  catch (error) { failed ??= error; evidence.error(error); }
}
console.log(JSON.stringify({ ok: !failed, ...evidence.finish(), ...(failed ? { error: failed.message } : {}) }));
if (failed) process.exitCode = 1;
