import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** 在隔离 Desktop 上验证真实 preload/Backend、导航与表格，不操作开发者数据。 */
export async function runProjectOverviewScenario({ cdp, evaluate, waitFor, projectId, openNodeDatabase }) {
  // 与其他真实交互场景一致：后台遮挡会暂停动画，不能让离场弹窗拦住鼠标手势。
  await cdp.send('Page.bringToFront');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const value = JSON.stringify(projectId);
  const fixtures = await evaluate(cdp, `(async () => {
    const { workspaceGateway: gateway } = await import('/apps/renderer/shared/ipc/workspaceGateway.ts');
    const folder = await gateway['create-folder']({projectId:${value}, name:'报告'});
    if (!folder.success) throw new Error(JSON.stringify(folder));
    const documents = [];
    for (const [name, parentId] of [['行业报告',folder.data.folderId], ['访谈纪要',null]]) {
      const content = {type:'doc',content:[{type:'rootBlock',attrs:{id:crypto.randomUUID()},content:[{type:'baseBlock',attrs:{id:crypto.randomUUID(),blockType:'base'},content:[{type:'text',text:name === '行业报告' ? '储能需求增长' : '访谈原文'}]}]}]};
      const result = await gateway['create-document']({projectId:${value}, name, parentId});
      if (!result.success) throw new Error(JSON.stringify(result));
      const saved = await gateway['save-document']({documentId: result.data.documentId, content});
      if (!saved.success) throw new Error(JSON.stringify(saved));
      documents.push(result.data.documentId);
    }
    return documents;
  })()`);
  // 复用真实持久化合同，只给隔离 fixture 补来源对话和旧修改时间，不调用付费模型。
  const db = openNodeDatabase();
  try {
    const conversation = db.prepare('SELECT conversation_id FROM conversations WHERE project_id = ? ORDER BY title LIMIT 1').get(projectId);
    db.prepare("UPDATE action_ledger_entries SET actor_kind = 'run', run_id = 'overview-fixture', root_run_id = 'overview-fixture', conversation_id = ? WHERE document_id = ?").run(conversation.conversation_id, fixtures[0]);
    const old = Date.now() - 40 * 86_400_000;
    db.prepare('UPDATE workspace_nodes SET created_at = ?, updated_at = ? WHERE id = ?').run(old, old, fixtures[1]);
    db.prepare('UPDATE action_ledger_entries SET recorded_at = ? WHERE document_id = ?').run(old, fixtures[1]);
  } finally { db.close(); }
  const openOverview = () => evaluate(cdp, `(async () => { const { getWorkspaceNavigationPort }=await import('/apps/renderer/shared/ports/workspaceNavigationPort.ts'); await getWorkspaceNavigationPort().openProjectOverview(${value}); })()`);
  const setSearch = text => evaluate(cdp, `(() => { const input=document.querySelector('.project-overview__search-input'); input.value=${JSON.stringify(text)}; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const selectFilter = async (index, text) => {
    await evaluate(cdp, `document.querySelectorAll('.project-overview-filter__trigger')[${index}].click()`);
    await waitFor(() => evaluate(cdp, `Array.from(document.querySelectorAll('.project-overview-filter__options [role="menuitem"]')).some(el=>el.textContent.trim()===${JSON.stringify(text)})`), `筛选选项 ${text}`);
    await evaluate(cdp, `Array.from(document.querySelectorAll('.project-overview-filter__options [role="menuitem"]')).find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`);
  };
  await openOverview();
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 2`), '概览真实文档');
  assert.equal(await evaluate(cdp, `document.querySelector('.project-nav-overview-entry')?.getAttribute('aria-current')`), 'page');
  const screenshot = async name => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const target = join(tmpdir(), `linnya-project-overview-${name}.png`);
    writeFileSync(target, Buffer.from(result.data, 'base64'));
    console.log(`[project-overview] screenshot: ${target}`);
  };
  await screenshot('light');
  await evaluate(cdp, `(async () => {
    const { useUIStore } = await import('/apps/renderer/shared/stores/ui.ts'); useUIStore().setTheme('dark');
  })()`);
  await waitFor(() => evaluate(cdp, `document.documentElement.getAttribute('data-linnya-ui-theme') === 'dark'`), '暗色主题');
  await screenshot('dark');
  await evaluate(cdp, `document.querySelector('.project-overview-columns button').click()`);
  await waitFor(() => evaluate(cdp, `document.querySelector('.project-overview-columns__panel')?.getBoundingClientRect().height > 0`), '列设置');
  await screenshot('columns');
  const originalOrder = await evaluate(cdp, `Array.from(document.querySelectorAll('.project-overview__header-cell'),el=>el.textContent.trim())`);
  await evaluate(cdp, `(() => { const items=document.querySelectorAll('.project-overview-columns__item'); const transfer=new DataTransfer(); items[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer})); items[1].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer})); })()`);
  assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll('.project-overview__header-cell'),el=>el.textContent.trim())`), [originalOrder[0], originalOrder[2], originalOrder[1], ...originalOrder.slice(3)]);
  await evaluate(cdp, `document.querySelector('.project-overview-columns__reset').click()`);
  assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll('.project-overview__header-cell'),el=>el.textContent.trim())`), originalOrder);

  await evaluate(cdp, `document.querySelector('.project-overview-columns__item').click()`);
  assert.equal(await evaluate(cdp, `document.querySelectorAll('.project-overview__header-cell').length`), 5);
  await evaluate(cdp, `document.querySelector('.project-overview-columns button').click()`);
  await evaluate(cdp, `(() => { const input=document.querySelector('.project-overview__search-input'); input.value='行业'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 1`), '名称搜索');
  await evaluate(cdp, `(() => { const input=document.querySelector('.project-overview__search-input'); input.value=''; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 2`), '清除搜索');
  await setSearch('储能');
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 1 && document.querySelector('.project-overview__row').textContent.includes('行业报告')`), '正文搜索');
  await setSearch('');
  await selectFilter(0, '文档');
  await waitFor(() => evaluate(cdp, `document.querySelector('.project-overview-filter').classList.contains('is-active')`), '类型筛选');
  await evaluate(cdp, `document.querySelector('.project-overview-filter__clear').click()`);
  await selectFilter(1, '今天');
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 1 && document.querySelector('.project-overview__row').textContent.includes('行业报告')`), '今天筛选');
  await evaluate(cdp, `document.querySelector('.project-overview-filter__clear').click()`);
  await evaluate(cdp, `document.querySelectorAll('.project-overview-filter__trigger')[2].click()`);
  await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('.project-overview-filter__options'))`), '位置菜单');
  await evaluate(cdp, `Array.from(document.querySelectorAll('.project-overview-filter__options [role="menuitem"]')).find(el=>el.textContent.includes('根目录'))?.click()`);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 1 && document.querySelector('.project-overview__row').textContent.includes('访谈纪要')`), '根目录筛选');
  await evaluate(cdp, `document.querySelector('.project-overview-filter__clear').click()`);
  await evaluate(cdp, `document.querySelector('.project-overview__knowledge-base').click()`);
  await waitFor(() => evaluate(cdp, `Array.from(document.querySelectorAll('.project-knowledge-base-modal-body .kb-item button')).some(el=>el.textContent.trim()==='关联')`), '知识库弹窗加载');
  await evaluate(cdp, `Array.from(document.querySelectorAll('.project-knowledge-base-modal-body .kb-item button')).find(el=>el.textContent.trim()==='关联').click()`);
  await evaluate(cdp, `document.querySelector('.project-knowledge-base-modal-body .project-kb-footer button').click()`);
  await waitFor(() => evaluate(cdp, `document.querySelector('.project-overview__knowledge-base-count').textContent.trim()==='1'`), '保存知识库关联后数量刷新');

  await evaluate(cdp, `(async () => {
    const { workspaceGateway: gateway } = await import('/apps/renderer/shared/ipc/workspaceGateway.ts');
    const result = await gateway['rename-node']({nodeId:${JSON.stringify(fixtures[0])},newName:'更新报告'});
    if (!result.success) throw new Error(JSON.stringify(result));
  })()`);
  await waitFor(() => evaluate(cdp, `document.querySelector('.project-overview__body')?.textContent.includes('更新报告')`), '修改后自动刷新');
  await evaluate(cdp, `document.querySelector('.project-overview__conversation').click()`);
  await waitFor(() => evaluate(cdp, `!document.querySelector('.project-overview') && document.body.innerText.includes('E2E 对话 A 回答')`), '打开生成对话');
  await openOverview();
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 2`), '从对话返回概览');
  await evaluate(cdp, `Array.from(document.querySelectorAll('.project-overview__row')).find(el=>el.textContent.includes('更新报告')).click()`);
  await waitFor(() => evaluate(cdp, `!document.querySelector('.project-overview') && Boolean(document.querySelector('.tiptap'))`), '点击文件进入编辑器');
  await evaluate(cdp, `document.querySelector('.project-nav-overview-entry').click()`);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 2`), '返回概览');
  await evaluate(cdp, `document.querySelector('.project-overview__cell--name .project-overview__sort').click()`);
  const sorted = await evaluate(cdp, `Array.from(document.querySelectorAll('.project-overview__name'),el=>el.textContent.trim())`);
  await evaluate(cdp, `document.querySelector('.project-overview__cell--name .project-overview__sort').click()`);
  assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll('.project-overview__name'),el=>el.textContent.trim())`), sorted.reverse());
  let lastResizeRect = null;
  const resize = await waitFor(async () => {
    const rect = await evaluate(cdp, `(() => {const el=document.querySelector('.project-overview__resize'); const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,width:el.parentElement.getBoundingClientRect().width,hit:document.elementFromPoint(x,y)===el}})()`);
    const settled = rect.hit && lastResizeRect?.x === rect.x && lastResizeRect?.y === rect.y;
    lastResizeRect = rect;
    return settled ? rect : null;
  }, '导航过渡结束后列宽手柄可点击');
  await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',x:resize.x,y:resize.y,button:'left',clickCount:1});
  await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:resize.x+40,y:resize.y,button:'left',buttons:1});
  await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:resize.x+40,y:resize.y,button:'left',clickCount:1});
  await waitFor(() => evaluate(cdp, `Math.abs(document.querySelector('.project-overview__resize').parentElement.getBoundingClientRect().width - ${resize.width + 40}) < 2`), '鼠标调整列宽');
  await evaluate(cdp, `document.querySelector('.project-overview__resize').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  assert.equal(await evaluate(cdp, `document.querySelector('.project-overview__resize').parentElement.getBoundingClientRect().width`), resize.width);
  const added = await evaluate(cdp, `(async () => {const {workspaceGateway:g}=await import('/apps/renderer/shared/ipc/workspaceGateway.ts');const r=await g['create-document']({projectId:${value},name:'临时文件'});if(!r.success)throw new Error(r.error);return r.data.documentId})()`);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 3`), '新建自动刷新');
  await evaluate(cdp, `(async () => {const {workspaceGateway:g}=await import('/apps/renderer/shared/ipc/workspaceGateway.ts');const r=await g['delete-node']({nodeId:${JSON.stringify(added)}});if(!r.success)throw new Error(r.error)})()`);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 2`), '删除自动刷新');
  const timeOrigin = await evaluate(cdp, 'performance.timeOrigin');
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(() => evaluate(cdp, `performance.timeOrigin !== ${timeOrigin} && Boolean(document.querySelector('.project-row, .project-chat-panel'))`), '重新加载');
  await openOverview();
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 2`), '重载概览');
  assert.equal(await evaluate(cdp, `document.querySelectorAll('.project-overview__header-cell').length`), 5, '列偏好应保留');
  const largeDb = openNodeDatabase();
  try {
    const insert = largeDb.prepare("INSERT INTO workspace_nodes (id, project_id, type, name, created_at, updated_at) VALUES (?, ?, 'document', ?, 1, 1)");
    largeDb.transaction(() => {for(let i=0;i<5000;i++) insert.run(`overview-large-${i}`, projectId, `批量文件-${String(i).padStart(4,'0')}`)})();
  } finally { largeDb.close(); }
  // 离开再进入，以正常快照加载大量数据；不直接写 renderer store。
  await evaluate(cdp, `document.querySelector('.project-overview__conversation').click()`);
  await waitFor(() => evaluate(cdp, `!document.querySelector('.project-overview')`), '离开概览');
  await openOverview();
  await waitFor(() => evaluate(cdp, `document.querySelector('.project-overview__stats')?.textContent.includes('5002')`), '5,002 份文件首屏');
  assert.ok(await evaluate(cdp, `document.querySelectorAll('.project-overview__row').length < 60`), '表格必须虚拟渲染');
  await evaluate(cdp, `(() => { const s=document.querySelector('.project-overview__scroll');s.scrollTop=s.scrollHeight; })()`);
  await waitFor(() => evaluate(cdp, `document.querySelector('.project-overview__body')?.textContent.includes('批量文件-4999')`), '大表滚到底');
  await setSearch('行业');
  await waitFor(() => evaluate(cdp, `document.querySelector('.project-overview__clear-all')`), '无结果状态');
  await setSearch('更新报告');
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.project-overview__row').length === 1`), '大表滚动后筛选');
  console.log('[project-overview] 真实 Desktop 浅色/暗色、导航、名称/正文搜索、三个筛选、排序、列拖序/调宽/重置/持久化、知识库关联、修改/新建/删除刷新、文件/对话打开和 5,002 行虚拟列表通过');

}
