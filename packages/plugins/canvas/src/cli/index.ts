import { parseCanvasCli, CanvasCliFailure } from '../backend/features/canvasCli';

/** 人/CI只读adapter，Agent facade独立拒绝database/project参数。help不加载原生DB。 */
async function main(): Promise<void> {
  const { argv, databasePath, projectId, conversationId } = parseStandaloneScope(
    process.argv.slice(2)
  );
  const command = parseCanvasCli(argv);
  if (command.kind === 'help') {
    process.stdout.write(
      JSON.stringify({
        command: 'canvas standalone',
        usage:
          '--database <sqlite> --project <id> read|show|find|neighbors|region|check <workspace:path>; --conversation <id> receipt <workspace:path> <request-id>',
        note: '只读。回执查询还需显式conversation；编辑和render使用当前App的linnya-canvas facade，本入口不装配mutation runtime。',
      }) + '\n'
    );
    return;
  }
  if (
    command.kind === 'apply' ||
    command.kind === 'arrange' ||
    command.kind === 'render' ||
    command.kind === 'groups' ||
    command.kind === 'changes'
  )
    throw new CanvasCliFailure(
      'read_only',
      'Standalone只提供只读查询和receipt；修改、渲染请使用当前App。'
    );
  if (!projectId)
    throw new CanvasCliFailure(
      'project_required',
      'Standalone需要显式--project，不能猜测项目范围。'
    );
  const query =
    command.kind === 'receipt'
      ? { ...command, conversationId: requireConversationId(conversationId) }
      : command;
  const [{ default: Database }, paths, { readCanvasStandalone }] = await Promise.all([
    import('better-sqlite3'),
    import('@plugin/backend/workspaceDatabasePath'),
    import('../backend/orchestration/readCanvasStandalone'),
  ]);
  const database = new Database(databasePath ?? paths.getWorkspaceDatabasePath(), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    process.stdout.write(
      JSON.stringify(await readCanvasStandalone(database, projectId, query)) + '\n'
    );
  } finally {
    database.close();
  }
}
function parseStandaloneScope(values: readonly string[]) {
  const argv: string[] = [];
  let databasePath: string | undefined;
  let projectId: string | undefined;
  let conversationId: string | undefined;
  for (let index = 0; index < values.length; index++) {
    const flag = values[index];
    if (flag !== '--database' && flag !== '--project' && flag !== '--conversation') {
      argv.push(flag);
      continue;
    }
    const value = values[++index];
    if (!value || value.startsWith('--'))
      throw new CanvasCliFailure('missing_argument', `${flag}需要值。`);
    if (flag === '--database') {
      if (databasePath) throw new CanvasCliFailure('invalid_arguments', '不能重复指定database。');
      databasePath = value;
    } else if (flag === '--project') {
      if (projectId) throw new CanvasCliFailure('invalid_arguments', '不能重复指定project。');
      projectId = value;
    } else {
      if (conversationId)
        throw new CanvasCliFailure('invalid_arguments', '不能重复指定conversation。');
      conversationId = value;
    }
  }
  return { argv, databasePath, projectId, conversationId };
}
function requireConversationId(value: string | undefined): string {
  if (!value)
    throw new CanvasCliFailure(
      'conversation_required',
      'receipt查询需要显式--conversation，不能猜测对话。'
    );
  return value;
}
async function finish(code: number) {
  if (process.versions.electron) {
    const { app } = await import('electron');
    app.exit(code);
  } else process.exitCode = code;
}
void main().then(
  () => finish(0),
  async error => {
    // 内部启动异常可能包含数据库磁盘路径，不回显stack或原始message。
    const failure =
      error instanceof CanvasCliFailure
        ? { code: error.code, message: error.message }
        : { code: 'standalone_unavailable', message: '无法读取数据库或当前画布格式。' };
    await new Promise<void>(resolve =>
      process.stdout.write(JSON.stringify({ error: failure }) + '\n', () => resolve())
    );
    await finish(8);
  }
);
