import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runLinnyaAppServerProcess as runBackend } from '../../../app-server-runtime/orchestration/runLinnyaAppServerProcess';
import { createHeadlessAppServerBackendComposition } from '../../../app-server-runtime/orchestration/createHeadlessAppServerBackendComposition';
import { FrozenCorpusSchema, digest } from '../definitions/historicalCorpus';
import { createHistoricalToolEnvironment } from '../orchestration/createHistoricalToolEnvironment';
import { createProjectLifecycle } from 'src/domains/projects';

const configSchema = z
  .object({
    corpusFile: z.string().min(1),
    corpusSha256: z.string().regex(/^[a-f0-9]{64}$/),
    workspaceRoot: z.string().min(1),
    receiptFile: z.string().min(1),
    modelFiles: z
      .array(
        z
          .object({
            name: z.enum(['user_models.json', 'provider_configurations.json']),
            path: z.string().min(1),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
      )
      .length(2),
  })
  .strict();

/** 独立构建的实验入口；生产 entry 永远不导入本模块或识别这些配置。 */
export async function runLinnyaAppServerProcess(): Promise<void> {
  const configFile = process.env.LINNYA_HISTORICAL_RUNTIME_CONFIG;
  if (!configFile) throw new Error('Historical runtime requires an explicit configuration');
  const configBytes = readFileSync(configFile);
  const config = configSchema.parse(JSON.parse(configBytes.toString('utf8')));
  const corpusBytes = readFileSync(config.corpusFile);
  if (digest(corpusBytes) !== config.corpusSha256) throw new Error('Frozen corpus hash changed');
  const corpus = FrozenCorpusSchema.parse(JSON.parse(corpusBytes.toString('utf8')));
  // 重启不回落生产装配。首版只接纳全新 Workspace，失败身份留档后另行决定是否重跑。
  if (readdirSync(config.workspaceRoot).length !== 0)
    throw new Error('Historical runtime requires a new empty Workspace; reopening is unavailable');
  writeFileSync(
    path.join(config.workspaceRoot, 'historical-runtime-owner.json'),
    JSON.stringify({
      configSha256: digest(configBytes),
      corpusSha256: config.corpusSha256,
    }),
    { flag: 'wx', mode: 0o600 }
  );
  mkdirSync(path.join(config.workspaceRoot, 'Models'));
  for (const file of config.modelFiles) {
    const bytes = readFileSync(file.path);
    if (digest(bytes) !== file.sha256)
      throw new Error(`Frozen model configuration changed: ${file.name}`);
    writeFileSync(path.join(config.workspaceRoot, 'Models', file.name), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
  }
  const environment = createHistoricalToolEnvironment(corpus);
  await runBackend(input => {
    if (
      path.resolve(input.bootstrap.backend_facts.runtimePathRoots.workspaceRoot) !==
      path.resolve(config.workspaceRoot)
    )
      throw new Error('Historical Workspace identity does not match bootstrap');
    const composition = createHeadlessAppServerBackendComposition(input);
    writeFileSync(
      config.receiptFile,
      JSON.stringify(
        {
          schemaVersion: 1,
          startedAt: new Date().toISOString(),
          corpusId: corpus.corpusId,
          corpusSha256: config.corpusSha256,
          configSha256: digest(configBytes),
          cutoffExclusive: corpus.cutoffExclusive,
          sourceCount: corpus.documents.length,
          workspaceRoot: config.workspaceRoot,
          liveWeb: false,
          physicalReads: false,
          arbitraryCode: false,
          knowledge: false,
          reopen: false,
        },
        null,
        2
      ) + '\n',
      { flag: 'wx', mode: 0o600 }
    );
    return {
      ...composition,
      backendHostDependencies: {
        ...composition.backendHostDependencies,
        agentToolEnvironment: environment,
        conversationExecutionRuntimeFactory: {
          async create(dependencies) {
            // 实验新 Workspace 的唯一项目通过正式 owner 建立；不写 SQL、不借用用户项目。
            createProjectLifecycle(dependencies.db).create({ name: 'Historical research', description: 'Isolated corpus experiment' });
            createProjectLifecycle(dependencies.db).create({ name: 'Runtime verification', description: 'Synthetic document checks; excluded from the research project' });
            return composition.backendHostDependencies.conversationExecutionRuntimeFactory.create(
              dependencies
            );
          },
        },
      },
    };
  });
}
