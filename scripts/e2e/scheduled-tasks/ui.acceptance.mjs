import assert from 'node:assert/strict';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { startChatFixture } from './chatFixture.mjs';

/**
 * 定时任务界面验收：隔离探针 + 本机回环模型，像真人一样在界面上新建、立即运行、暂停恢复、删除，
 * 检查设置页降权与删除模型时的提示，再用开发态注入的时钟与时区验证时钟异常、改时区与时钟前跳。
 * 只读取 preload 的定时任务接口作为断言依据，所有操作都走真实点击。
 */
const evidence = createEvidence('scheduled-tasks-ui', { files: [
  'scripts/e2e/scheduled-tasks/ui.acceptance.mjs',
  'scripts/e2e/scheduled-tasks/chatFixture.mjs',
] });
const fixture = await startChatFixture();
const json = JSON.stringify;
const MODEL_NAME = 'Scheduled fixture model';
const EDITOR = '.scheduled-task-editor';
let failed;
const instances = [];

function probeFor(name) {
  const test = acceptance(`${name}-${process.pid}`, { evidence });
  instances.push(test);
  const { run } = test;
  const evaluate = async code => (await run('eval', `(async()=>{${code}})()`)).value;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function clickNamed(role, name, within, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { entries } = await run('snapshot', '--json', '--role', role, '--max-lines', '200', ...(within ? ['--within', within] : []));
      const targets = entries.filter(entry => (name instanceof RegExp ? name.test(entry.name) : entry.name === name));
      if (targets.length === 1) return run('click', targets[0].ref);
      if (Date.now() > deadline) {
        evidence.json(`missing-${name}-${role}`, (await run('snapshot', '--json', '--max-lines', '200')).entries);
        assert.equal(targets.length, 1, `${role}: ${name} (${targets.length})`);
      }
      await sleep(250);
    }
  }
  async function until(read, ready, label, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (ready(value)) return value;
      assert.ok(Date.now() < deadline, `timed out: ${label} (${json(value).slice(0, 400)})`);
      await sleep(250);
    }
  }
  const api = (method, request) => evaluate(`return window.electronAPI.scheduledTasks[${json(method)}](${request === undefined ? '' : json(request)});`);
  const listTasks = async () => {
    const result = await api('list', {});
    return result.data ?? result;
  };
  async function registerFixtureModel() {
    return evaluate(`const session=await window.electronAPI.invoke('api:get-port');
      const response=await fetch('http://127.0.0.1:'+session.port+'/api/v1/custom-api-onboarding/models',{method:'POST',
        headers:{'X-API-Token':session.token,'content-type':'application/json'},
        body:${json(json({ provider_name: 'Scheduled fixture', api_format: 'openai_compatible', base_url: fixture.url, api_key: fixture.apiKey,
          endpoint_model_id: 'scheduled-fixture', display_name: MODEL_NAME, context_window_tokens: 64000, max_output_tokens: 4096, supports_image_input: false }))}});
      const body=await response.json();if(!response.ok)throw new Error(JSON.stringify(body));return body.model_id;`);
  }
  /** 打开任务列表；已经停在某个任务的详情时，点侧栏同样回到列表。 */
  async function openScheduledTasks() {
    const { entries } = await run('snapshot', '--json', '--role', 'button', '--max-lines', '80', '--within', 'aside');
    const back = entries.find(entry => entry.name === '返回');
    if (back) await run('click', back.ref);
    // 有未看的结果时，按钮名里带数字。
    await clickNamed('button', /^定时任务/u, 'aside');
    await run('wait', '--text', '新建任务', '--timeout', '30000');
  }
  async function createTaskThroughForm(name) {
    await clickNamed('button', '新建任务', 'main');
    await run('wait', '--text', '新建定时任务', '--timeout', '30000');
    await clickNamed('textbox', '名称', EDITOR);
    await run('type', name);
    await clickNamed('textbox', '每次要做的事', EDITOR);
    await run('type', 'Summarize the scheduled acceptance status in one line.');
    await clickNamed('button', '模型', EDITOR);
    await run('click', `text=${MODEL_NAME}`);
    await clickNamed('button', '创建', '.modal-overlay');
    const result = await until(listTasks, list => list.tasks?.some(task => task.name === name), `task ${name} created`);
    // 建好后进入这个任务的详情。
    await run('wait', '--selector', '[data-testid="scheduled-task-detail"]', '--timeout', '15000');
    return result;
  }
  return { run, evaluate, clickNamed, until, api, listTasks, registerFixtureModel, openScheduledTasks, createTaskThroughForm, sleep };
}

try {
  const main = probeFor('scheduled-ui');
  await main.run('up', '--size', '1440x1000', '--no-build', '--scheduled-tasks', '--scheduled-tasks-timezone', 'Asia/Shanghai');
  const modelId = await main.registerFixtureModel();
  await main.run('reload');
  let task;

  await evidence.check('界面新建任务：表单校验时间、选定模型与档位后创建，列表与下次时间出现', async () => {
    await main.openScheduledTasks();
    const result = await main.createTaskThroughForm('验收任务');
    task = result.tasks.find(item => item.name === '验收任务');
    assert.equal(task.model_config_id, modelId);
    assert.equal(task.permission_level, 'standard');
    assert.equal(task.state, 'scheduled', json(task));
    assert.ok(task.next_run_at > Date.now(), 'next run in the future');
    await main.run('wait', '--text', '验收任务', '--timeout', '15000');
    await main.run('shot');
  });

  await evidence.check('新建弹窗：月历选日、直接输入时间，下次时间随之更新；Esc 先关面板再关弹窗，不创建任务', async () => {
    const state = () => main.evaluate(`// 隐藏页面里的下拉也留在文档中，只看画出来的那个。
      const panel = [...document.querySelectorAll('.linnya-dropdown-panel, .custom-select__options')]
        .map(node => node.getBoundingClientRect()).find(rect => rect.width > 0 && rect.height > 0) ?? null;
      return {
        editor: Boolean(document.querySelector('.scheduled-task-editor')),
        panel: panel && { inside: panel.top >= 0 && panel.left >= 0 && panel.bottom <= innerHeight && panel.right <= innerWidth },
        preview: document.querySelector('[data-testid="scheduled-task-schedule-preview"]')?.innerText ?? '',
        selected: document.querySelector('.scheduled-task-editor [data-date][aria-pressed="true"], .scheduled-task-editor [data-date][aria-selected="true"]')?.dataset.date ?? null,
      };`);
    await main.openScheduledTasks();
    await main.clickNamed('button', '新建任务', 'main');
    await main.clickNamed('button', '重复方式', EDITOR);
    await main.until(state, value => value.panel?.inside === true, 'repeat menu inside the window', 5_000);
    await main.run('click', 'text=仅一次');
    await main.clickNamed('button', '下一页', EDITOR);
    await main.run('click', '--selector', `${EDITOR} [data-date$="-15"]`);
    await main.run('click', '--selector', `${EDITOR} .linnya-time-picker input`);
    await main.run('type', '2115');
    await main.until(state, value => value.panel?.inside === true, 'time list inside the window', 5_000);
    await main.run('press', 'Enter');
    const picked = await main.until(state, value => /15日.*21:15/u.test(value.preview), 'preview follows the picked day and time', 10_000);
    evidence.json('once-form', picked);
    await main.run('shot');
    await main.run('click', '--selector', `${EDITOR} .linnya-time-picker input`);
    await main.until(state, value => value.panel !== null, 'time list open', 5_000);
    await main.run('press', 'Escape');
    const afterFirst = await main.until(state, value => value.panel === null, 'first Escape closes the list', 5_000);
    assert.equal(afterFirst.editor, true, 'dialog stays after the first Escape');
    await main.run('press', 'Escape');
    await main.until(state, value => !value.editor, 'second Escape closes the dialog', 5_000);
    assert.deepEqual((await main.listTasks()).tasks.map(item => item.name), ['验收任务']);
    await main.clickNamed('button', /^验收任务/u, 'main');
    await main.run('wait', '--selector', '[data-testid="scheduled-task-detail"]', '--timeout', '15000');
  });

  await evidence.check('立即运行：运行完成写入记录，侧栏出现带未读的折叠行，前台提示完成', async () => {
    await main.clickNamed('button', '立即运行', 'main');
    const done = await main.until(main.listTasks, result => {
      const current = result.tasks.find(item => item.id === task.id);
      return current?.last_run?.status === 'completed' ? current : null;
    }, 'manual run completed', 120_000);
    const current = done.tasks.find(item => item.id === task.id);
    assert.equal(current.last_run.trigger, 'manual');
    assert.ok(current.unread_count >= 1, json(current));
    await main.run('wait', '--text', '已完成', '--timeout', '30000');
    await main.run('shot');
  });

  await evidence.check('暂停与恢复：开关停用后不再有下次时间，恢复后重新排期', async () => {
    const toggle = '.switch-control:has(input[aria-label="已启用"])';
    await main.run('click', '--selector', toggle);
    const paused = await main.until(main.listTasks, result => result.tasks.find(item => item.id === task.id)?.state === 'paused', 'paused');
    assert.equal(paused.tasks.find(item => item.id === task.id).next_run_at, null);
    await main.run('shot');
    await main.run('click', '--selector', toggle);
    const resumed = await main.until(main.listTasks, result => result.tasks.find(item => item.id === task.id)?.state === 'scheduled', 'resumed');
    assert.ok(resumed.tasks.find(item => item.id === task.id).next_run_at > Date.now());
  });

  await evidence.check('运行中删除任务：确认框说明正在运行并可一并停止，勾选确认后任务删除、这次运行停止', async () => {
    fixture.holdNext(60_000);
    await main.clickNamed('button', '立即运行', 'main');
    const running = await main.until(main.listTasks, result => {
      const current = result.tasks.find(item => item.id === task.id);
      return current?.last_run?.status === 'running' ? current.last_run : null;
    }, 'run in progress', 30_000);
    const runningRun = running.tasks.find(item => item.id === task.id).last_run;
    await main.clickNamed('button', '更多', 'main');
    await main.run('click', 'text=删除任务');
    await main.run('wait', '--text', '这个任务正在运行', '--timeout', '10000');
    const dialog = await main.evaluate("return [...document.querySelectorAll('.modal-overlay')].map(node => node.innerText.trim()).join('\\n')");
    evidence.json('delete-running-dialog', { dialog });
    assert.match(dialog, /删除“验收任务”？/u);
    assert.match(dialog, /同时停止正在运行的这次/u);
    await main.run('click', 'text=同时停止正在运行的这次');
    await main.run('shot');
    const buttons = await main.evaluate("return [...document.querySelectorAll('.modal-overlay button')].map(b => b.innerText.trim()).filter(Boolean)");
    evidence.json('delete-running-buttons', buttons);
    const confirm = buttons.find(text => text !== '取消' && /删除/u.test(text));
    assert.ok(confirm, json(buttons));
    await main.run('click', `text=${confirm}`);
    await main.until(main.listTasks, result => !result.tasks.some(item => item.id === task.id), 'task deleted', 30_000);
    // 被挂住的那次模型请求在删除后被 App 断开，说明这次运行确实停了，而不是在后台继续。
    await main.until(() => Promise.resolve(fixture.aborted), count => count >= 1, 'running request aborted', 30_000);
    evidence.json('after-delete', { abortedRequests: fixture.aborted, runningRun });
    await main.run('shot');
  });
  let lowered;
  await evidence.check('设置页降低全局档位：确认框点出受影响的定时任务数，选择一起调低后任务降到只读', async () => {
    await main.openScheduledTasks();
    const created = await main.createTaskThroughForm('降权任务');
    lowered = created.tasks.find(item => item.name === '降权任务');
    assert.equal(lowered.permission_level, 'standard');
    await main.clickNamed('button', '设置');
    await main.run('click', 'text=命令权限');
    await main.run('wait', '--settle');
    await main.run('click', 'text=只读');
    await main.run('wait', '--text', '个定时任务', '--timeout', '10000');
    const dialog = await main.evaluate("return [...document.querySelectorAll('.modal-overlay')].map(node => node.innerText.trim()).join('\\n')");
    evidence.json('downgrade-dialog', { dialog });
    assert.match(dialog, /1 个定时任务/u, dialog);
    await main.run('shot');
    const buttons = await main.evaluate("return [...document.querySelectorAll('.modal-overlay button')].map(b => b.innerText.trim()).filter(Boolean)");
    const together = buttons.find(text => /一起/u.test(text));
    assert.ok(together, json(buttons));
    await main.run('click', `text=${together}`);
    await main.until(main.listTasks, result => result.tasks.find(item => item.id === lowered.id)?.permission_level === 'read_only', 'task lowered');
    // 恢复全局档位；记录调高时的确认框（如有），确认后任务不会被调回去。
    await main.run('click', 'text=标准');
    await main.run('wait', '--settle');
    const raiseDialog = await main.evaluate("return [...document.querySelectorAll('.modal-overlay')].map(node => node.innerText.trim()).join('\\n')");
    evidence.json('raise-dialog', { raiseDialog });
    assert.match(raiseDialog, /开启标准权限/u);
    await main.run('click', 'text=接受风险，确认开启');
    await main.run('wait', '--settle');
    const after = await main.listTasks();
    assert.equal(after.tasks.find(item => item.id === lowered.id).permission_level, 'read_only');
  });

  await evidence.check('删除模型前的提示：模型详情说明有定时任务在用、删除后下次运行记为失败', async () => {
    await main.run('click', 'text=模型管理');
    await main.run('wait', '--text', MODEL_NAME, '--timeout', '15000');
    await main.clickNamed('button', MODEL_NAME, '[role="dialog"]');
    // 提示在点“删除模型”后的确认框里，作为风险说明；只看提示，取消不删。
    await main.run('wait', '--text', '删除模型', '--timeout', '15000');
    await main.run('click', 'text=删除模型');
    await main.run('wait', '--text', '个定时任务指定了这个模型', '--timeout', '15000');
    const notice = await main.evaluate("return [...document.querySelectorAll('.modal-overlay')].map(node => node.innerText.trim()).join('\\n')");
    evidence.json('model-detail-notice', { notice });
    assert.match(notice, /有 \d+ 个定时任务指定了这个模型。删除后，它们下一次运行会记为失败并通知你/u, notice);
    await main.run('shot');
    const buttons = await main.evaluate("return [...document.querySelectorAll('.modal-overlay--alert button')].map(b => b.innerText.trim()).filter(Boolean)");
    assert.ok(buttons.includes('取消'), json(buttons));
    await main.clickNamed('button', '取消', '.modal-overlay--alert');
    const models = await main.evaluate("const s=await window.electronAPI.invoke('api:get-port');const r=await fetch('http://127.0.0.1:'+s.port+'/api/v1/models',{headers:{'X-API-Token':s.token}});return (await r.json()).models.map(m=>m.id);");
    assert.ok(models.includes(modelId), 'cancel keeps the model');
  });

  // ---- 时间边界：每类用独立实例，避免前一类留下的记录影响下一类 ----
  // 读不到合法结果时直接失败，不能把接口错误当成“没有运行记录”放过去。
  const runsOf = async (probe, taskId) => {
    const result = await probe.api('runs', { task_id: taskId, limit: 50 });
    assert.ok(Array.isArray(result?.runs), `runs result: ${json(result).slice(0, 300)}`);
    return result.runs;
  };
  const localWall = (epochMs, timeZone) => new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(epochMs);

  const anomaly = probeFor('scheduled-clock-1997');
  await anomaly.run('up', '--size', '1440x1000', '--no-build', '--scheduled-tasks',
    '--scheduled-tasks-clock', '1997-01-01T09:00:00+08:00', '--scheduled-tasks-timezone', 'Asia/Shanghai');
  await anomaly.registerFixtureModel();
  await anomaly.run('reload');
  let anomalyTask;
  await evidence.check('系统时钟停在 1997 年：横幅写明显示的日期，不按时运行，“立即运行”仍能完成', async () => {
    await anomaly.openScheduledTasks();
    await anomaly.run('wait', '--selector', '[data-testid="scheduled-tasks-clock-anomaly"]', '--timeout', '15000');
    const banner = await anomaly.evaluate("return document.querySelector('[data-testid=\"scheduled-tasks-clock-anomaly\"]').innerText");
    assert.match(banner, /系统时间看起来不对（显示为 1997/u, banner);
    assert.match(banner, /“立即运行”仍可用/u);
    const created = await anomaly.createTaskThroughForm('时钟异常任务');
    anomalyTask = created.tasks.find(item => item.name === '时钟异常任务');
    await anomaly.clickNamed('button', '立即运行', 'main');
    await anomaly.until(anomaly.listTasks, result => result.tasks.find(item => item.id === anomalyTask.id)?.last_run?.status === 'completed',
      'manual run completed under the 1997 clock', 120_000);
    const runs = await runsOf(anomaly, anomalyTask.id);
    assert.ok(runs.some(item => item.trigger === 'manual' && item.status === 'completed'), 'the manual run is in the history');
    assert.deepEqual(runs.filter(item => item.trigger !== 'manual'), [], 'no scheduled runs while the clock is wrong');
    await anomaly.run('shot');
  });

  await evidence.check('时钟恢复：横幅自动消失，29 年的时段不会被逐个补跑', async () => {
    await anomaly.run('scheduled-clock', '--clock', 'system');
    await anomaly.run('wait', '--selector', '[data-testid="scheduled-tasks-clock-anomaly"]', '--state', 'detached', '--timeout', '15000');
    await anomaly.sleep(5_000);
    const runs = await runsOf(anomaly, anomalyTask.id);
    const scheduled = runs.filter(item => item.trigger !== 'manual');
    evidence.json('recovered-runs', runs.map(item => ({ trigger: item.trigger, status: item.status, reason: item.reason, skipped: item.skipped_count })));
    assert.ok(scheduled.filter(item => ['queued', 'running', 'completed'].includes(item.status)).length <= 1, 'at most one catch-up run');
    await anomaly.run('shot');
  });

  const zones = probeFor('scheduled-clock-zones');
  await zones.run('up', '--size', '1440x1000', '--no-build', '--scheduled-tasks', '--scheduled-tasks-timezone', 'Asia/Shanghai');
  await zones.registerFixtureModel();
  await zones.run('reload');
  let zoneTask;
  await evidence.check('改时区：上海换到伦敦后，下次运行按伦敦的 09:00 重新推算', async () => {
    await zones.openScheduledTasks();
    const created = await zones.createTaskThroughForm('时区任务');
    zoneTask = created.tasks.find(item => item.name === '时区任务');
    assert.equal(localWall(zoneTask.next_run_at, 'Asia/Shanghai'), '09:00');
    await zones.run('scheduled-clock', '--timezone', 'Europe/London');
    const moved = await zones.until(zones.listTasks, result => {
      const current = result.tasks.find(item => item.id === zoneTask.id);
      return current && localWall(current.next_run_at, 'Europe/London') === '09:00' ? current : null;
    }, 'next run recomputed for London', 15_000);
    evidence.json('timezone-switch', {
      before: { at: zoneTask.next_run_at, shanghai: localWall(zoneTask.next_run_at, 'Asia/Shanghai') },
      after: { at: moved.tasks.find(item => item.id === zoneTask.id).next_run_at },
    });
    await zones.run('shot');
  });

  await evidence.check('时钟前跳 2 年：最多补跑最近一次，更早的合并成一条跳过记录', async () => {
    // 先回到上海并等它重新排期，再单独拨钟；同一步里换时区会按“东飞跳过的时段不补跑”处理。
    await zones.run('scheduled-clock', '--timezone', 'Asia/Shanghai');
    await zones.until(zones.listTasks, result => {
      const current = result.tasks.find(item => item.id === zoneTask.id);
      return current && localWall(current.next_run_at, 'Asia/Shanghai') === '09:00';
    }, 'back to Shanghai', 15_000);
    await zones.run('scheduled-clock', '--clock', 'offset:+2y');
    const runs = await zones.until(() => runsOf(zones, zoneTask.id), list => list.some(item => item.trigger !== 'manual'),
      'catch-up recorded after the jump', 60_000);
    await zones.sleep(5_000);
    const settled = await runsOf(zones, zoneTask.id);
    const scheduled = settled.filter(item => item.trigger !== 'manual');
    evidence.json('forward-jump-runs', settled.map(item => ({ trigger: item.trigger, status: item.status, reason: item.reason, skipped: item.skipped_count })));
    assert.ok(scheduled.filter(item => ['queued', 'running', 'completed', 'failed'].includes(item.status)).length <= 1, 'at most one catch-up run');
    assert.equal(scheduled.filter(item => item.trigger === 'catch_up' && item.status !== 'skipped').length, 1, 'exactly one catch-up run');
    const folded = settled.find(item => item.status === 'skipped' && item.reason === 'outside_catch_up_window');
    assert.ok(folded && folded.skipped_count > 100, `older slots folded into one skipped record: ${json(folded)}`);
    void runs;
    // 运行记录里那条跳过记录显示合并次数（“……，共 N 次”），不是 N 行。
    await zones.openScheduledTasks();
    await zones.clickNamed('button', /^时区任务/u, 'main');
    await zones.run('wait', '--text', `共 ${folded.skipped_count} 次`, '--timeout', '15000');
    await zones.run('shot');
  });
} catch (error) {
  failed = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  for (const test of instances) {
    try { evidence.json('teardown', await test.finish({ clean: !failed })); }
    catch (error) { failed ??= error; evidence.error(error); }
  }
  await fixture.stop();
  evidence.json('fixture', { requests: fixture.requests.length, errors: fixture.errors });
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
