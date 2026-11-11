#!/usr/bin/env node
/**
 * 标签基准评分：读一个或多个 run.json（run.mjs 的输出），按标准答案打分，写 summary.md / scores.json。
 *   node scripts/benchmark/tags-semantic/score.mjs <结果目录> [<结果目录> …] --out <目录>
 * 标签名不设标准答案：每类资料取与之重合最多的那个标签当作“该类的标签”，再看每份文档对不对。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DOCUMENTS, FINAL_MANUSCRIPTS, KINDS, PRICE_INTERVIEWS, STAGE_ALIASES, TOPIC_WORDS } from './fixture.mjs';

const baseName = name => name.replace(/\.md$/, '');
const tokensOf = task => {
  const totals = task?.audit?.llm?.actual_tokens;
  return totals ? { input: totals.input_tokens, output: totals.output_tokens, cacheRead: totals.cache_read_tokens_reported ?? 0 } : null;
};

function stageOf(value) {
  if (typeof value !== 'string') return null;
  for (const [stage, aliases] of Object.entries(STAGE_ALIASES)) {
    if (aliases.some(alias => value.includes(alias))) return stage;
  }
  return null;
}

/** 每类资料匹配一个标签（重合最多、且不被别的类抢走），算每份文档的类型是否正确。 */
function scoreKinds(documents) {
  const docsByName = new Map(documents.map(doc => [doc.name, doc]));
  const candidates = [];
  for (const kind of KINDS) {
    const expected = DOCUMENTS.filter(doc => doc.kind === kind).map(doc => doc.name);
    const counts = new Map();
    for (const name of expected) for (const tag of docsByName.get(name)?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    for (const [tag, count] of counts) candidates.push({ kind, tag, count });
  }
  candidates.sort((a, b) => b.count - a.count);
  const kindTag = {};
  const used = new Set();
  for (const candidate of candidates) {
    if (kindTag[candidate.kind] || used.has(candidate.tag)) continue;
    kindTag[candidate.kind] = candidate.tag;
    used.add(candidate.tag);
  }
  const typeTags = new Set(Object.values(kindTag));
  const perDoc = DOCUMENTS.map(expected => {
    const actual = docsByName.get(expected.name)?.tags ?? [];
    const right = kindTag[expected.kind] !== undefined && actual.includes(kindTag[expected.kind]);
    const wrongType = actual.filter(tag => typeTags.has(tag) && tag !== kindTag[expected.kind]);
    return { name: expected.name, kind: expected.kind, tags: actual, correct: right && wrongType.length === 0 };
  });
  return { kindTag, correct: perDoc.filter(doc => doc.correct).length, total: perDoc.length, perDoc };
}

function scoreManuscripts(documents) {
  const docsByName = new Map(documents.map(doc => [doc.name, doc]));
  const rows = DOCUMENTS.filter(doc => doc.kind === 'manuscript').map(expected => {
    const values = docsByName.get(expected.name)?.values ?? {};
    const stageEntry = Object.entries(values).find(([, value]) => stageOf(value) !== null);
    const authorEntry = Object.entries(values).find(([, value]) => typeof value === 'string' && value.includes(expected.author));
    return {
      name: expected.name,
      expectedStage: expected.stage,
      stageField: stageEntry?.[0] ?? null,
      stageValue: stageEntry?.[1] ?? null,
      stageCorrect: stageEntry ? stageOf(stageEntry[1]) === expected.stage : false,
      authorCorrect: Boolean(authorEntry),
    };
  });
  return {
    stageCorrect: rows.filter(row => row.stageCorrect).length,
    authorCorrect: rows.filter(row => row.authorCorrect).length,
    total: rows.length,
    rows,
  };
}

/** 回答通常先列答案，再说“其余……没有”；只看前面正面列出的部分。 */
function positivePart(answer) {
  const cut = answer.search(/其余|其他文稿|另外|此外|通篇没有|没有提到|都没有|没有定稿|未定稿/);
  if (cut <= 0) return answer;
  // 否定词可能在文件名之后（“《某某》没有提到价格”），从那一行的行首截断。
  return answer.slice(0, Math.max(0, answer.lastIndexOf('\n', cut)));
}

function scoreFinalAnswer(fullAnswer) {
  if (!fullAnswer) return { correct: false, reason: '无回答' };
  const answer = positivePart(fullAnswer);
  const hits = FINAL_MANUSCRIPTS.filter(doc => answer.includes(baseName(doc.name)) && answer.includes(doc.author));
  const wrong = DOCUMENTS.filter(doc => doc.kind === 'manuscript' && doc.stage !== 'final' && answer.includes(baseName(doc.name)));
  return {
    correct: hits.length === FINAL_MANUSCRIPTS.length && wrong.length === 0,
    found: hits.map(doc => baseName(doc.name)),
    wronglyIncluded: wrong.map(doc => baseName(doc.name)),
  };
}

function scorePriceAnswer(fullAnswer) {
  if (!fullAnswer) return { correct: false, reason: '无回答' };
  const answer = positivePart(fullAnswer);
  const keys = { '曼谷经销商-1012.md': ['曼谷经销商', '曼谷'], '柏林车队客户-1018.md': ['柏林车队客户', '柏林'] };
  const found = PRICE_INTERVIEWS.filter(name => keys[name].some(key => answer.includes(key)));
  const wrong = answer.includes('蒙特雷选址');
  return { correct: found.length === PRICE_INTERVIEWS.length && !wrong, found, wronglyIncluded: wrong ? ['蒙特雷选址-1025'] : [] };
}

function linnyaCommands(task) {
  const commands = [...(task?.shellCommands ?? []), ...(task?.approvals ?? []).map(item => item.command)].filter(Boolean);
  return [...new Set(commands)];
}

function skillActivated(task) {
  const byTool = task?.audit?.tools?.by_tool ?? [];
  return byTool.some(tool => /skill/i.test(tool.tool_name ?? tool.name ?? ''));
}

export function scoreRun(record) {
  const task = key => record.tasks.find(item => item.key === key);
  const tagsProject = snapshot => snapshot?.projects?.[record.tagsProjectId];
  const oneoff = task('oneoff');
  const organize = task('organize');
  const track = task('track');
  const final = task('track')?.snapshot ?? organize?.snapshot;
  const documents = tagsProject(final)?.documents ?? [];
  const initialTags = new Set(record.initial?.tags?.map(tag => tag.name) ?? []);
  const initialFields = new Set(record.initial?.properties?.map(property => property.name) ?? []);
  const tagNames = final?.tags?.map(tag => tag.name) ?? [];
  const newTags = tagNames.filter(name => !initialTags.has(name));
  const usedTags = [...new Set(documents.flatMap(doc => doc.tags))];
  const taggedDocs = documents.filter(doc => doc.tags.length > 0);
  const filters = tagsProject(final)?.savedFilters ?? [];
  const statusField = final?.properties?.find(property => property.valueType === 'select' && property.options.some(option => stageOf(option)));
  return {
    label: record.label,
    model: record.model.display,
    oneoff: {
      status: oneoff?.status,
      answer: scorePriceAnswer(oneoff?.answer),
      tagsCreated: oneoff?.snapshot ? oneoff.snapshot.tags.filter(tag => !initialTags.has(tag.name)).length : null,
      savedFilters: tagsProject(oneoff?.snapshot)?.savedFilters?.length ?? null,
      tokens: tokensOf(oneoff),
    },
    organize: {
      status: organize?.status,
      skillActivated: skillActivated(organize),
      preexistingTags: [...initialTags],
      tags: newTags,
      usedTags,
      fields: final?.properties?.filter(property => !initialFields.has(property.name)).map(property => `${property.name}(${property.valueType}${property.options.length ? `: ${property.options.join('/')}` : ''})`) ?? [],
      topicTags: usedTags.filter(name => TOPIC_WORDS.some(word => name.includes(word))),
      tagsPerDoc: taggedDocs.length ? +(taggedDocs.reduce((sum, doc) => sum + doc.tags.length, 0) / taggedDocs.length).toFixed(2) : 0,
      untagged: documents.filter(doc => doc.tags.length === 0).map(doc => doc.name),
      kinds: scoreKinds(documents),
      manuscripts: scoreManuscripts(documents),
      statusIsSelect: Boolean(statusField),
      shellCommands: linnyaCommands(organize).length,
      tokens: tokensOf(organize),
    },
    track: {
      status: track?.status,
      savedFilters: filters.map(filter => ({
        name: filter.name, origin: filter.origin, pinned: filter.pinned,
        layout: filter.definition?.layout?.kind,
        groupedByStatus: Boolean(statusField) && filter.definition?.layout?.group_by === statusField.id,
      })),
      tokens: tokensOf(track),
    },
    query: { status: task('query')?.status, answer: scoreFinalAnswer(task('query')?.answer), usedQuery: linnyaCommands(task('query')).some(command => /linnya\s+query/.test(command)), tokens: tokensOf(task('query')) },
    control: { status: task('control')?.status, answer: scoreFinalAnswer(task('control')?.answer), tokens: tokensOf(task('control')) },
    controlUntouched: (record.tasks.at(-1)?.snapshot?.projects?.[record.controlProjectId]?.documents ?? []).every(doc => doc.tags.length === 0),
  };
}

const fmtTokens = tokens => (tokens ? `${tokens.input + tokens.cacheRead}（缓存 ${tokens.cacheRead}）/${tokens.output}` : '—');
const yes = value => (value ? '✓' : '✗');

function summaryMarkdown(scores, records) {
  const lines = ['# 标签基准结果', '', '| 指标 | ' + scores.map(score => score.model).join(' | ') + ' |', '|---|' + scores.map(() => '---|').join('')];
  const row = (label, pick) => lines.push(`| ${label} | ${scores.map(pick).join(' | ')} |`);
  row('一次性问题 回答正确', score => yes(score.oneoff.answer.correct));
  row('一次性问题 未建标签/筛选', score => yes(score.oneoff.tagsCreated === 0 && score.oneoff.savedFilters === 0));
  row('整理 激活 Skill', score => yes(score.organize.skillActivated));
  row('开始前已有标签', score => score.organize.preexistingTags.join('、') || '无');
  row('新建标签', score => score.organize.tags.join('、') || '—');
  row('实际用到的标签', score => score.organize.usedTags.join('、') || '—');
  row('新建字段', score => score.organize.fields.join('；') || '—');
  row('主题标签', score => score.organize.topicTags.join('、') || '无');
  row('每份文档标签数', score => score.organize.tagsPerDoc);
  row('类型正确', score => `${score.organize.kinds.correct}/${score.organize.kinds.total}`);
  row('文稿状态正确', score => `${score.organize.manuscripts.stageCorrect}/${score.organize.manuscripts.total}`);
  row('文稿作者正确', score => `${score.organize.manuscripts.authorCorrect}/${score.organize.manuscripts.total}`);
  row('状态是单选', score => yes(score.organize.statusIsSelect));
  row('跟踪 保存的筛选', score => score.track.savedFilters.map(filter => `${filter.name}(${filter.origin}${filter.pinned ? '' : ',建议'},${filter.layout}${filter.groupedByStatus ? ',按状态' : ''})`).join('；') || '—');
  row('定稿查询 正确（有标签）', score => yes(score.query.answer.correct));
  row('定稿查询 用了 linnya query', score => yes(score.query.usedQuery));
  row('定稿查询 正确（对照，无标签）', score => yes(score.control.answer.correct));
  row('整理 Shell 命令数', score => score.organize.shellCommands);
  row('token 输入（含缓存命中）/输出：一次性', score => fmtTokens(score.oneoff.tokens));
  row('token 输入/输出：整理', score => fmtTokens(score.organize.tokens));
  row('token 输入/输出：跟踪', score => fmtTokens(score.track.tokens));
  row('token 输入/输出：定稿查询', score => fmtTokens(score.query.tokens));
  row('token 输入/输出：对照查询', score => fmtTokens(score.control.tokens));
  row('对照项目未被打标签', score => yes(score.controlUntouched));
  lines.push('');
  for (const record of records) {
    lines.push(`## ${record.model.display} 回答`, '');
    for (const task of record.tasks) {
      lines.push(`### ${task.key}（${task.status ?? task.runnerError}）`, '', '```text', (task.answer ?? '').trim().slice(0, 1500), '```', '');
    }
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  if (outIndex < 0 || args.length < 3) throw new Error('用法：score.mjs <结果目录>… --out <目录>');
  const out = path.resolve(args[outIndex + 1]);
  const dirs = args.filter((_, index) => index !== outIndex && index !== outIndex + 1);
  const records = dirs.map(dir => JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')));
  const scores = records.map(scoreRun);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'scores.json'), `${JSON.stringify(scores, null, 2)}\n`);
  writeFileSync(path.join(out, 'summary.md'), summaryMarkdown(scores, records));
  process.stdout.write(`${path.join(out, 'summary.md')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
