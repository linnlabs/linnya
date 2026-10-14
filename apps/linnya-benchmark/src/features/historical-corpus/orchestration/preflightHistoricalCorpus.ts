import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  HistoricalCorpusManifestSchema,
  type HistoricalCorpusPreflight,
} from '../definitions/historicalCorpus';

import {
  evaluateHistoricalCorpus,
  hashCorpusBytes,
  type LoadedCorpusFile,
  type LoadedHistoricalCandidate,
} from '../functions/evaluateHistoricalCorpus';

async function readBoundFile(root: string, relative: string): Promise<Buffer> {
  if (path.isAbsolute(relative)) throw new Error('Absolute source paths are not allowed');
  const resolved = await realpath(path.resolve(root, relative));
  const within = path.relative(root, resolved);
  if (!within || within.startsWith(`..${path.sep}`) || within === '..' || path.isAbsolute(within))
    throw new Error('Source file is outside the manifest directory');
  if (!(await stat(resolved)).isFile()) throw new Error('Source is not a regular file');
  return readFile(resolved);
}

export async function preflightHistoricalCorpus(input: {
  readonly manifestFile: string;
  readonly output: string;
}): Promise<HistoricalCorpusPreflight> {
  const manifestBytes = await readFile(input.manifestFile);
  const manifest = HistoricalCorpusManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  const root = await realpath(path.dirname(input.manifestFile));
  const load = async (file: string): Promise<LoadedCorpusFile> => {
    try {
      return { bytes: await readBoundFile(root, file) };
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
  const loaded: LoadedHistoricalCandidate[] = await Promise.all(
    manifest.candidates.map(async source => {
      if (source.status === 'pending') return { source };
      const [original, projection, evidence] = await Promise.all([
        load(source.original.path),
        load(source.projection.path),
        load(source.verification.evidence.path),
      ]);
      return { source, files: { original, projection, evidence } };
    })
  );
  const { documents, issues } = evaluateHistoricalCorpus(manifest, loaded);
  const ready = issues.length === 0;
  const corpus =
    JSON.stringify(
      {
        schemaVersion: 1,
        corpusId: manifest.corpusId,
        cutoffExclusive: manifest.cutoffExclusive,
        documents,
      },
      null,
      2
    ) + '\n';
  const report: HistoricalCorpusPreflight = {
    schemaVersion: 1,
    corpusId: manifest.corpusId,
    manifestSha256: hashCorpusBytes(manifestBytes),
    cutoffExclusive: manifest.cutoffExclusive,
    checkedAt: new Date().toISOString(),
    status: ready ? 'corpus_ready' : 'blocked',
    executionIsolation: 'not_checked',
    eligibleSourceIds: documents.map(source => source.id),
    issues,
    ...(ready ? { corpusSha256: hashCorpusBytes(corpus) } : {}),
  };
  // 新目录才能生成回执，旧成功材料不能在一次失败重跑后继续伪装成当前产物。
  await mkdir(path.dirname(input.output), { recursive: true });
  await mkdir(input.output);
  if (ready)
    await writeFile(path.join(input.output, 'corpus.json'), corpus, { flag: 'wx', mode: 0o600 });
  await writeFile(
    path.join(input.output, 'preflight.json'),
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 }
  );
  return report;
}
