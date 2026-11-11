import type Database from 'better-sqlite3';
import type {
  BackendPluginCliAccessPlan,
  BackendPluginCliExecutionContext,
  BackendPluginCliPreparation,
  BackendPluginCliResult,
} from '@linnya/plugin-host-contract/backend';
import { readStoredRunActor, withActionActor, type ActionActor } from 'src/domains/action-ledger';
import { createDocumentReferenceOperations } from 'src/domains/document-references';
import {
  createSqliteSemanticLayer,
  runSemanticQuery,
  SemanticLayerError,
  type SemanticObjectState,
  type SemanticPropertyDefinition,
  type SemanticQueryFilter,
  type SemanticTagField,
  type SqliteSemanticLayer,
} from 'src/domains/semantic-layer';
import {
  readWorkspaceDocumentIdentity,
  resolveWorkspaceDocumentPath,
} from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
import { readPersistedWorkspaceVfsNode } from 'src/features/workspace/vfs';
import {
  describeChange,
  fitLines,
  formatObject,
  formatSchema,
  formatSemanticError,
  formatTagLine,
  objectJson,
  schemaJson,
  shellQuote,
} from '../functions/formatSemantic';
import {
  LINKS_USAGE,
  parseLinksCommand,
  parsePropsCommand,
  parseQueryCommand,
  parseSchemaCommand,
  PROPS_USAGE,
  QUERY_USAGE,
  SCHEMA_USAGE,
  type PropsChange,
  type PropsCommand,
  type QueryCommand,
  type RawTagField,
  type SchemaCommand,
} from '../functions/parseSemanticCommands';
import { coerceCliValue, coerceQueryFilter, displayValue, findProperty, jsonValue } from '../functions/semanticCliValues';
import { savedFilterFromQuery } from '../functions/savedFilterFromQuery';
import { projectSavedFilterConditionKey } from '@app/schemas';
import { createSqliteSavedFilterStore } from '../../../adapters/persistence/saved-filters';

export const SEMANTIC_CLI_COMMANDS = ['schema', 'props', 'query', 'links'] as const;
export type SemanticCliCommand = (typeof SEMANTIC_CLI_COMMANDS)[number];
export const SEMANTIC_USAGE = [SCHEMA_USAGE, PROPS_USAGE, QUERY_USAGE, LINKS_USAGE].join('\n');

const USAGE: Record<SemanticCliCommand, string> = { schema: SCHEMA_USAGE, props: PROPS_USAGE, query: QUERY_USAGE, links: LINKS_USAGE };
const TRUNCATED = '…输出已截短：收紧条件、减小 --limit，或用 --json。';

function access(write: boolean): BackendPluginCliAccessPlan {
  return {
    internalDataAccess: 'required', conversationFiles: write ? 'write' : 'none', externalFiles: 'denied',
    network: 'denied', guiControl: 'denied', localIpcControl: 'denied',
  };
}

const ok = (stdout: string): BackendPluginCliResult => ({ exitCode: 0, stdout, stderr: '' });
const fail = (exitCode: number, stderr: string): BackendPluginCliResult => ({ exitCode, stdout: '', stderr: `${stderr.trimEnd()}\n` });
const json = (value: unknown) => ok(`${JSON.stringify(value)}\n`);

/** 批量写入里某份文档出错：带上路径再整体回滚。 */
class DocumentFailure extends Error {
  constructor(readonly path: string, readonly cause: SemanticLayerError) {
    super(cause.message);
  }
}

class CliFailure extends Error {}

interface Runtime {
  readonly db: Database.Database;
  readonly layer: SqliteSemanticLayer;
  readonly maxOutputCharacters: number;
}

function createRuntime(db: Database.Database, maxOutputCharacters: number): Runtime {
  return { db, maxOutputCharacters, layer: createSqliteSemanticLayer(db, { read: id => readWorkspaceDocumentIdentity(db, id) }) };
}

function pathOf(db: Database.Database, documentId: string): string {
  const node = readPersistedWorkspaceVfsNode(db, documentId);
  return node ? `workspace:${node.path}` : `（已不在工作区：${documentId}）`;
}

function resolveDocument(db: Database.Database, projectId: string, path: string): string {
  let identity: ReturnType<typeof resolveWorkspaceDocumentPath>;
  try {
    identity = resolveWorkspaceDocumentPath(db, { projectId, path });
  } catch {
    identity = null;
  }
  if (!identity) throw new CliFailure(`object_not_found 当前项目里没有文档 ${path}`);
  return identity.id;
}

/** 写入身份由 Host 冻结的运行编号确定；找不到运行记录时按外部入口记账。 */
function actorFor(db: Database.Database, context: BackendPluginCliExecutionContext): ActionActor {
  const run = context.agentRunId ? readStoredRunActor(db, context.agentRunId, context.conversationId ?? null) : undefined;
  return run ?? { kind: 'external' };
}

function tagFields(raw: readonly RawTagField[], properties: readonly SemanticPropertyDefinition[]): SemanticTagField[] {
  return raw.map(field => {
    const property = findProperty(properties, field.field);
    if (!property || field.defaultValue === null) return { propertyId: property?.id ?? field.field };
    const value = coerceCliValue(property, field.defaultValue);
    return value === null ? { propertyId: property.id } : { propertyId: property.id, defaultValue: value as SemanticTagField['defaultValue'] };
  });
}

function executeSchema(runtime: Runtime, command: Exclude<SchemaCommand, { kind: 'help' }>): BackendPluginCliResult {
  const { layer } = runtime;
  switch (command.kind) {
    case 'list':
      return command.json ? json(schemaJson(layer.listTags(), layer.listProperties())) : ok(formatSchema(layer.listTags(), layer.listProperties()));
    case 'add-field': {
      const property = layer.defineProperty({
        name: command.name, valueType: command.valueType, options: command.options, allowSimilar: command.allowSimilar,
      });
      return ok(`已新建字段“${property.name}”。把它加到标签上：linnya schema set-fields 标签 --field ${shellQuote(property.name)} ...\n`);
    }
    case 'add-tag': {
      const tag = layer.defineTag({ name: command.name, fields: tagFields(command.fields, layer.listProperties()), allowSimilar: command.allowSimilar });
      return ok(`已新建标签 ${formatTagLine(tag, layer.listProperties())}\n`);
    }
    case 'set-fields': {
      const tag = layer.setTagFields(command.tag, tagFields(command.fields, layer.listProperties()));
      return ok(`已更新标签 ${formatTagLine(tag, layer.listProperties())}\n`);
    }
  }
}

function applyChange(layer: SqliteSemanticLayer, write: Parameters<SqliteSemanticLayer['setValues']>[0], change: PropsChange): SemanticObjectState {
  switch (change.action) {
    case 'tag': return layer.tagObject(write, change.tags);
    case 'untag': return layer.untagObject(write, change.tags);
    case 'restore': return layer.restoreObject(write, change.toRevision);
    case 'set': {
      const properties = layer.listProperties();
      const patch: Record<string, unknown> = {};
      for (const [field, raw] of change.assignments) {
        const property = findProperty(properties, field);
        // 未知字段原样交给语义层，由它报错并列出可用字段。
        patch[field] = property ? coerceCliValue(property, raw) : raw;
      }
      return layer.setValues(write, patch);
    }
  }
}

const ROLLBACK = Symbol('preview');

/**
 * 每份文档都要给期望版本，避免覆盖用户刚在面板里做的修改。不给版本时在事务里试写一遍再回滚：
 * 校验与真实写入完全相同，输出当前版本和变化，并给出可直接执行的命令。批量写入全部成功才提交。
 */
function executeWrite(
  runtime: Runtime,
  projectId: string,
  argv: readonly string[],
  command: Extract<PropsCommand, { kind: 'write' }>,
  actor: () => ActionActor,
): BackendPluginCliResult {
  const { db, layer } = runtime;
  const targets = command.paths.map(path => ({ path, id: resolveDocument(db, projectId, path) }));
  const { revisions } = command;
  const run = () => targets.map((target, index) => {
    const before = layer.readObject(projectId, { kind: 'document', id: target.id });
    try {
      const after = applyChange(layer, { projectId, ref: before.ref, expectedRevision: revisions?.[index] ?? before.revision }, command.change);
      return { path: target.path, before, after };
    } catch (error) {
      if (error instanceof SemanticLayerError) throw new DocumentFailure(target.path, error);
      throw error;
    }
  });
  if (revisions) {
    const outcomes = withActionActor(actor(), () => db.transaction(run).immediate());
    const lines = outcomes.map(({ path, before, after }) =>
      `${path}  版本 ${before.revision} → ${after.revision}  ${describeChange(before, after)}`);
    return ok(fitLines([`已写入 ${outcomes.length} 份文档：`, ...lines], runtime.maxOutputCharacters, TRUNCATED));
  }
  let outcomes: ReturnType<typeof run> = [];
  try {
    db.transaction(() => {
      outcomes = run();
      throw ROLLBACK;
    })();
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  const lines = outcomes.map(({ path, before, after }) => `${path}  版本 ${before.revision}  ${describeChange(before, after)}`);
  const commandLine = `linnya props ${argv.map(shellQuote).join(' ')} --rev ${outcomes.map(item => item.before.revision).join(',')}`;
  // 可执行的命令放在最后且不截短；预览行在剩余预算内截。
  const preview = fitLines(['预览，未写入：', ...lines], Math.max(200, runtime.maxOutputCharacters - commandLine.length - 16), TRUNCATED);
  return ok(`${preview}确认后执行：\n${commandLine}\n`);
}

function executeProps(
  runtime: Runtime,
  projectId: string,
  argv: readonly string[],
  command: Exclude<PropsCommand, { kind: 'help' }>,
  actor: () => ActionActor,
): BackendPluginCliResult {
  if (command.kind === 'write') return executeWrite(runtime, projectId, argv, command, actor);
  const id = resolveDocument(runtime.db, projectId, command.path);
  try {
    const state = runtime.layer.readObject(projectId, { kind: 'document', id });
    return command.json ? json(objectJson(command.path, state)) : ok(formatObject(command.path, state));
  } catch (error) {
    if (error instanceof SemanticLayerError) throw new DocumentFailure(command.path, error);
    throw error;
  }
}

/**
 * `--save`：查询成功后存成项目概览的筛选。用户明确要求的直接固定，`--suggest` 进“Agent 建议”。
 * 已有条件相同的筛选时不重复保存，告诉 Agent 用哪一个。
 */
function saveQuery(
  runtime: Runtime,
  projectId: string,
  conversationId: string | null,
  command: Extract<QueryCommand, { kind: 'query' }>,
  where: readonly SemanticQueryFilter[],
): string {
  if (!command.save) return '';
  const definition = savedFilterFromQuery({
    tags: command.tags, where, sort: command.sort, groupBy: command.groupBy,
    tagDefinitions: runtime.layer.listTags(), properties: runtime.layer.listProperties(),
  });
  const store = createSqliteSavedFilterStore(runtime.db);
  const key = projectSavedFilterConditionKey(definition);
  const same = store.list(projectId).find(filter => projectSavedFilterConditionKey(filter.definition) === key);
  if (same) return `已有条件相同的筛选“${same.name}”，没有重复保存。`;
  const saved = store.create({
    projectId, name: command.save.name, origin: 'agent', pinned: !command.save.suggest, conversationId, definition,
  });
  const layout = definition.layout.kind === 'board' ? '（看板）' : '';
  return command.save.suggest
    ? `已放进项目概览文件页的“Agent 建议”：“${saved.name}”${layout}。用户点“固定”后才出现在那一排，30 天没打开会自动清理。`
    : `已保存为项目概览文件页的筛选“${saved.name}”${layout}。`;
}

function executeQuery(
  runtime: Runtime,
  projectId: string,
  conversationId: string | null,
  command: Extract<QueryCommand, { kind: 'query' }>,
): BackendPluginCliResult {
  const tags = runtime.layer.listTags();
  const properties = runtime.layer.listProperties();
  const where = command.where.map(filter => coerceQueryFilter(filter, properties));
  const result = runSemanticQuery(runtime.db, {
    projectId,
    tags: command.tags,
    where,
    sort: command.sort,
    ...(command.groupBy ? { groupBy: command.groupBy } : {}),
    limit: command.limit,
  }, { tags, properties });
  const tagName = (id: string) => tags.find(tag => tag.id === id)?.name ?? id;
  const groupProperty = command.groupBy ? findProperty(properties, command.groupBy) : undefined;
  const groupLabel = (key: string | boolean | null) => key === null
    ? '（空）'
    : groupProperty ? displayValue(groupProperty, key) : String(key);
  const saved = saveQuery(runtime, projectId, conversationId, command, where);
  const rows = result.rows.map(row => ({
    row,
    path: pathOf(runtime.db, row.documentId),
    // 与 props get 同序：按标签顺序与标签内字段顺序，共用字段只出现一次。
    values: [...new Set(row.tagIds.flatMap(id => tags.find(tag => tag.id === id)?.fields.map(field => field.propertyId) ?? []))]
      .flatMap(id => properties.filter(property => property.id === id && row.values[id] !== undefined)),
  }));
  if (command.json) {
    return json({
      total: result.total, truncated: result.truncated,
      rows: rows.map(({ row, path, values }) => ({
        path, name: row.name, type: row.nodeType, revision: row.revision, tags: row.tagIds.map(tagName),
        values: Object.fromEntries(values.map(property => [property.name, jsonValue(property, row.values[property.id])])),
      })),
      ...(result.groups ? { groups: result.groups.map(group => ({ key: groupLabel(group.key), count: group.count })) } : {}),
      ...(saved ? { saved } : {}),
    });
  }
  const header = result.truncated
    ? `共 ${result.total} 份，显示前 ${rows.length} 份（加大 --limit 或收紧条件）`
    : `共 ${result.total} 份`;
  const lines = [header, ...rows.map(({ row, path, values }) => [
    path,
    row.tagIds.length ? `[${row.tagIds.map(tagName).join('、')}]` : '',
    values.map(property => `${property.name}=${displayValue(property, row.values[property.id])}`).join(' · '),
  ].filter(Boolean).join('  '))];
  if (result.groups) {
    lines.push(`按“${command.groupBy}”分组：${result.groups.map(group => `${groupLabel(group.key)} ${group.count}`).join(' · ')}`);
  }
  // 保存结果放在第一行之后，截断时也不会丢。
  if (saved) lines.splice(1, 0, saved);
  return ok(fitLines(lines, runtime.maxOutputCharacters, TRUNCATED));
}

function executeLinks(runtime: Runtime, projectId: string, path: string, limit: number): BackendPluginCliResult {
  const { db } = runtime;
  const id = resolveDocument(db, projectId, path);
  const operations = createDocumentReferenceOperations(db, { read: documentId => readWorkspaceDocumentIdentity(db, documentId) });
  const backlinks = new Map<string, number>();
  for (const link of operations.listBacklinks(id)) backlinks.set(link.sourceDocumentId, (backlinks.get(link.sourceDocumentId) ?? 0) + 1);
  const references = operations.listReferences(id);
  const section = (title: string, items: readonly (readonly [string, number])[]) => [
    `${title}（${items.length}）：`,
    ...items.slice(0, limit).map(([documentId, count]) => `- ${pathOf(db, documentId)}${count > 1 ? `  ${count} 处` : ''}`),
    ...(items.length > limit ? [`…还有 ${items.length - limit} 份未列出`] : []),
  ];
  return ok(fitLines([
    path,
    ...section('引用它的文档', [...backlinks]),
    ...section('它引用的文档', references.map(item => [item.document.id, item.referenceCount] as const)),
  ], runtime.maxOutputCharacters, TRUNCATED));
}

function guarded(run: () => BackendPluginCliResult): BackendPluginCliResult {
  try {
    return run();
  } catch (error) {
    if (error instanceof DocumentFailure) return fail(1, formatSemanticError(error.cause, error.path));
    if (error instanceof SemanticLayerError) return fail(1, formatSemanticError(error));
    if (error instanceof CliFailure) return fail(1, error.message);
    throw error;
  }
}

function parse(command: SemanticCliCommand, argv: readonly string[]) {
  switch (command) {
    case 'schema': return parseSchemaCommand(argv);
    case 'props': return parsePropsCommand(argv);
    case 'query': return parseQueryCommand(argv);
    case 'links': return parseLinksCommand(argv);
  }
}

/** prepare 只解析参数；读写数据库在通过父 Shell 权限校验后才发生。写命令需要 Shell 写权限。 */
export function prepareSemanticCli(input: {
  readonly db: Database.Database;
  readonly command: SemanticCliCommand;
  readonly argv: readonly string[];
  readonly maxOutputCharacters: number;
}): BackendPluginCliPreparation {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(input.command, input.argv);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '参数无效';
    return { status: 'completed', result: fail(2, `${reason}\n${USAGE[input.command]}`) };
  }
  if (parsed.kind === 'help') return { status: 'completed', result: ok(`${USAGE[input.command]}\n`) };
  const write = (parsed.kind === 'write' && parsed.revisions !== null)
    || (parsed.kind === 'query' && parsed.save !== null)
    || parsed.kind === 'add-field' || parsed.kind === 'add-tag' || parsed.kind === 'set-fields';
  const command = parsed;
  return {
    status: 'ready',
    plan: {
      access: access(write),
      async execute(context) {
        context.signal.throwIfAborted();
        const runtime = createRuntime(input.db, input.maxOutputCharacters);
        if (command.kind === 'list' || command.kind === 'add-field' || command.kind === 'add-tag' || command.kind === 'set-fields') {
          return guarded(() => executeSchema(runtime, command));
        }
        const { projectId } = context;
        if (!projectId) return fail(2, '当前对话没有所属项目。');
        return guarded(() => {
          switch (command.kind) {
            case 'get':
            case 'write':
              return executeProps(runtime, projectId, input.argv, command, () => actorFor(input.db, context));
            case 'query':
              return executeQuery(runtime, projectId, context.conversationId ?? null, command);
            case 'links':
              return executeLinks(runtime, projectId, command.path, command.limit);
          }
        });
      },
    },
  };
}
