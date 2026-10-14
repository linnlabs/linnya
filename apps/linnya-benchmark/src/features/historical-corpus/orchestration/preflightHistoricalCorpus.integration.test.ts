import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preflightHistoricalCorpus } from './preflightHistoricalCorpus';
import { hashCorpusBytes } from '../functions/evaluateHistoricalCorpus';
import type { HistoricalCorpusManifest } from '../definitions/historicalCorpus';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'historical-corpus-'));
  directories.push(root);
  const original = 'Historical source, published in August. Table: 100.';
  const proof = 'Synthetic historical registry entry: version 1.';
  await Promise.all([
    writeFile(path.join(root, 'source.html'), original),
    writeFile(path.join(root, 'source.txt'), original),
    writeFile(path.join(root, 'proof.txt'), proof),
  ]);
  const source = {
    id: 'source-1',
    url: 'https://example.test/old',
    title: 'Historical report',
    categories: ['baseline'],
    status: 'verified' as const,
    availableAt: '2026-08-31T15:59:59Z',
    original: { path: 'source.html', sha256: hashCorpusBytes(original) },
    projection: { path: 'source.txt', sha256: hashCorpusBytes(original) },
    verification: {
      kind: 'regulatory_archive' as const,
      versionId: 'v1',
      url: 'https://example.test/proof',
      evidence: { path: 'proof.txt', sha256: hashCorpusBytes(proof) },
      reviewer: 'Fixture operator',
      rationale: 'OPERATOR_ONLY_CANARY',
    },
  };
  const manifest: HistoricalCorpusManifest = {
    schemaVersion: 1,
    corpusId: 'fixture',
    cutoffExclusive: '2026-09-01T00:00:00+08:00',
    requiredCategories: ['baseline'],
    candidates: [source],
  };
  const manifestFile = path.join(root, 'manifest.json');
  const output = path.join(root, 'result');
  const save = async (value: unknown = manifest) => writeFile(manifestFile, JSON.stringify(value));
  await save();
  return { root, source, manifest, manifestFile, output, save };
}

describe('historical corpus admission', () => {
  it('固定原件/投影/证明后只导出作者白名单字段，成功也不称运行已经隔离', async () => {
    const f = await fixture();
    const result = await preflightHistoricalCorpus(f);
    expect(result).toMatchObject({
      status: 'corpus_ready',
      executionIsolation: 'not_checked',
      issues: [],
    });
    const corpus = await readFile(path.join(f.output, 'corpus.json'), 'utf8');
    expect(hashCorpusBytes(corpus)).toBe(result.corpusSha256);
    expect(corpus).toContain('Table: 100.');
    expect(corpus).not.toContain('OPERATOR_ONLY_CANARY');
    expect(corpus).not.toContain('proof.txt');
    await expect(preflightHistoricalCorpus(f)).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it.each(['2026-08-31T16:00:00Z', '2026-09-01T09:00:00+08:00'])(
    '拒绝截止时刻及以后的可得版本 %s',
    async availableAt => {
      const f = await fixture();
      f.source.availableAt = availableAt;
      await f.save();
      const result = await preflightHistoricalCorpus(f);
      expect(result.status).toBe('blocked');
      expect(result.issues.map(issue => issue.code)).toContain('not_before_cutoff');
      await expect(readFile(path.join(f.output, 'corpus.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  );

  it('不能用旧 URL/日期承载修改后的内容，原件、投影和证明都绑定字节', async () => {
    const f = await fixture();
    await Promise.all(
      ['source.html', 'source.txt', 'proof.txt'].map(file =>
        writeFile(path.join(f.root, file), 'FUTURE_RESULT_CANARY')
      )
    );
    const result = await preflightHistoricalCorpus(f);
    expect(result.issues.filter(issue => issue.code === 'hash_mismatch')).toHaveLength(3);
    expect(result.eligibleSourceIds).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('FUTURE_RESULT_CANARY');
  });

  it('没有历史证明的材料不能填满事前要求的类别', async () => {
    const f = await fixture();
    f.manifest.candidates = [
      {
        id: 'pending',
        title: 'Located only',
        url: 'https://example.test/pending',
        categories: ['baseline'],
        status: 'pending',
        reason: 'No historical version proof',
      },
    ];
    await f.save();
    const result = await preflightHistoricalCorpus(f);
    expect(result.issues.map(issue => issue.code)).toEqual(['pending_version', 'missing_category']);
  });

  it('拒绝同 URL 不同版本，不能借一次成功掩盖另一次取得', async () => {
    const f = await fixture();
    f.manifest.candidates.push({ ...f.source, id: 'source-2' });
    await f.save();
    expect((await preflightHistoricalCorpus(f)).issues.map(issue => issue.code)).toContain(
      'duplicate_identity'
    );
  });

  it('物理路径与符号链接不能把目录外答案带进投影', async () => {
    const f = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), 'historical-answer-'));
    directories.push(outside);
    const answer = path.join(outside, 'answer.txt');
    await writeFile(answer, 'FUTURE_RESULT_CANARY');
    await symlink(answer, path.join(f.root, 'answer-link'));
    f.source.projection.path = 'answer-link';
    await f.save();
    const result = await preflightHistoricalCorpus(f);
    expect(result.issues.map(issue => issue.code)).toContain('invalid_file');
    expect(result.eligibleSourceIds).toEqual([]);
  });

  it('manifest 意外夹带答案字段时拒绝整个输入，不静默抹除后继续', async () => {
    const f = await fixture();
    await f.save({ ...f.manifest, settlementAnswer: 'future' });
    await expect(preflightHistoricalCorpus(f)).rejects.toThrow();
    await expect(readFile(path.join(f.output, 'corpus.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each(['availableAt', 'cutoffExclusive'])(
    '非法时区不能通过 NaN 比较绕过截止门：%s',
    async field => {
      const f = await fixture();
      if (field === 'availableAt') f.source.availableAt = '2026-08-31T12:00:00+99:99';
      else f.manifest.cutoffExclusive = '2026-08-31T12:00:00+99:99';
      await f.save();
      await expect(preflightHistoricalCorpus(f)).rejects.toThrow(
        'Timestamp must have a valid UTC offset'
      );
      await expect(readFile(path.join(f.output, 'corpus.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  );

  it.each(['original', 'evidence'])(
    '空文件即使 hash 正确也不能充当历史原件或证明：%s',
    async field => {
      const f = await fixture();
      const file = field === 'original' ? f.source.original : f.source.verification.evidence;
      await writeFile(path.join(f.root, file.path), '');
      file.sha256 = hashCorpusBytes('');
      await f.save();
      const result = await preflightHistoricalCorpus(f);
      expect(result.status).toBe('blocked');
      expect(result.issues.map(issue => issue.code)).toContain('invalid_file');
    }
  );
});
