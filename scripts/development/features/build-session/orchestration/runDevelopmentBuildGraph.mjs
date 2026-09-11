/** 每个节点只有一次初始构建；后继节点等待成功事件，不读取历史 dist 猜测 ready。 */
export async function runDevelopmentBuildGraph(tasks, start) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('开发构建任务 ID 重复');
  const running = new Map();
  function visit(id, ancestors = []) {
    if (ancestors.includes(id)) throw new Error(`开发构建依赖循环: ${[...ancestors, id].join(' -> ')}`);
    if (running.has(id)) return running.get(id);
    const task = byId.get(id);
    if (!task) throw new Error(`缺少开发构建任务: ${id}`);
    const dependencies = (task.dependencies ?? []).map(dependency => visit(dependency, [...ancestors, id]));
    const ready = Promise.all(dependencies).then(() => start(task).ready);
    running.set(id, ready);
    return ready;
  }
  await Promise.all(tasks.map(task => visit(task.id)));
}
