import { parseCanvasCli } from '../backend/features/canvasCli/functions/parseCanvasCli';
import { CanvasCliFailure } from '../backend/features/canvasCli';

/** 人/CI只读adapter，Agent facade独立拒绝database/project参数。help不加载原生DB。 */
async function main(): Promise<void> {
  const { argv, databasePath, projectId } = parseStandaloneScope(process.argv.slice(2));
  const command = parseCanvasCli(argv);
  if (command.kind === 'help') {
    process.stdout.write(JSON.stringify({ command: 'canvas standalone', usage: '--database <sqlite> --project <id> read|show|find|neighbors|region|check <workspace:path>', note: '只读。编辑和render使用当前App的linnya-canvas facade；本入口不装配mutation runtime。' }) + '\n'); return;
  }
  if (command.kind === 'apply' || command.kind === 'arrange' || command.kind === 'render' || command.kind === 'groups') throw new CanvasCliFailure('read_only', 'Standalone只提供read/show/find/neighbors/region/check，修改和渲染请使用当前App。');
  if (!projectId) throw new CanvasCliFailure('project_required', 'Standalone需要显式--project，不能猜测项目范围。');
  const [{ default: Database }, paths, { readCanvasStandalone }] = await Promise.all([
    import('better-sqlite3'), import('@plugin/backend/workspaceDatabasePath'), import('../backend/orchestration/readCanvasStandalone'),
  ]);
  const database = new Database(databasePath ?? paths.getWorkspaceDatabasePath(), { readonly: true, fileMustExist: true });
  try { process.stdout.write(JSON.stringify(await readCanvasStandalone(database, projectId, command)) + '\n'); }
  finally { database.close(); }
}
function parseStandaloneScope(values: readonly string[]) {
  const argv: string[] = []; let databasePath: string | undefined; let projectId: string | undefined;
  for (let index = 0; index < values.length; index++) {
    const flag = values[index];
    if (flag !== '--database' && flag !== '--project') { argv.push(flag); continue; }
    const value = values[++index];
    if (!value || value.startsWith('--')) throw new CanvasCliFailure('missing_argument', `${flag}需要值。`);
    if (flag === '--database') { if (databasePath) throw new CanvasCliFailure('invalid_arguments', '不能重复指定database。'); databasePath = value; }
    else { if (projectId) throw new CanvasCliFailure('invalid_arguments', '不能重复指定project。'); projectId = value; }
  }
  return { argv, databasePath, projectId };
}
async function finish(code: number) {
  if (process.versions.electron) { const { app } = await import('electron'); app.exit(code); }
  else process.exitCode = code;
}
void main().then(() => finish(0), async error => {
  // 内部启动异常可能包含数据库磁盘路径，不回显stack或原始message。
  const failure = error instanceof CanvasCliFailure ? { code: error.code, message: error.message } : { code: 'standalone_unavailable', message: '无法读取数据库或当前画布格式。' };
  await new Promise<void>(resolve => process.stdout.write(JSON.stringify({ error: failure }) + '\n', () => resolve()));
  await finish(8);
});
