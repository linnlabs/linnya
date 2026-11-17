import assert from 'node:assert/strict';

/** 使用现有夹具和正式导航；场景断言对应用户行为，不固定样式细节。 */
export async function overviewScenario(test, evidence) {
  const { run } = test;
  await evidence.check('导航到知识库后可以打开新项目概览', async () => {
    await run('click', 'text=知识库');
    await run('wait', '--text', '新建知识库');
    const fixture = await run('fixture', 'project-overview');
    const opened = await run('open', fixture.projectId, '--overview');
    assert.equal(opened.opened.kind, 'overview');
    const rows = await run('eval', `document.querySelectorAll('.project-overview__row').length`);
    // open 已等待导航；数据到达走真实页面条件，不用固定延时。
    if (rows.value !== fixture.documents) await run('wait', '--expr', `document.querySelectorAll('.project-overview__row').length === ${fixture.documents}`);
    const snapshot = await run('snapshot', '--within', '.project-overview', '--all', '--max-lines', '100');
    assert.match(snapshot.snapshot, /行业报告/);
    assert.match(snapshot.snapshot, /演示稿/);
    await run('shot', '--selector', '.project-overview');
  });
  await evidence.check('筛选菜单动效可见且关闭后恢复表格', async () => {
    const menu = '.project-overview-filter__menu';
    const frames = await run('record', 'frames', '--target', menu, '--at', '20,75,130', '--',
      'click', '--selector', '.project-overview-filter__trigger');
    assert.equal(new Set(frames.frames.map(frame => frame.sha256)).size, 3);
    await run('press', 'Escape');
    await run('wait', '--selector', menu, '--state', 'detached');
  });
  await evidence.check('列宽逐步拖动跟手', async () => {
    const handle = '.project-overview__resize';
    const divider = `(() => {const r=document.querySelector('${handle}').getBoundingClientRect();return r.x+r.width/2})()`;
    const drag = await run('drag', handle, '--by', '80,0', '--steps', '8', '--sample', divider, '--expect-follow', 'x');
    assert.equal(drag.samples.length, 8);
    evidence.json('column-drag', drag.samples);
    await run('shot', '--selector', '.project-overview__table', '--pad', '4');
  });
  await evidence.check('打开 Slides 后页面就绪且没有 Renderer 错误', async () => {
    const row = await run('eval', `[...document.querySelectorAll('.project-overview__row')].findIndex(row=>row.innerText.includes('演示稿'))`);
    assert.ok(row.value >= 0);
    await run('click', `.project-overview__row:nth-child(${row.value + 1}) .project-overview__name`);
    await run('wait', '--selector', '.slides-page');
    await run('shot', '--selector', '.slides-page');
    const logs = await run('logs', '--level', 'error');
    assert.equal(logs.total, 0, JSON.stringify(logs.entries));
  });
}
