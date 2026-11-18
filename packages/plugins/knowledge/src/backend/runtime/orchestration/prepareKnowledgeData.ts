import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { AdoptedHostData } from '@plugin/backend/adoptedHostDataRuntime';
import type { PluginProjectReadPort } from '@plugin/backend/projectReadRuntime';
import { isGraphExtractionDumpEnabled } from '../../graph/application/graphExtractionDebugDump';
import { BetterSqliteMetadataRepository } from '../../infrastructure/sqlite/better-sqlite-metadata.repository';
import { BetterSqliteKnowledgeGraphRepository } from '../../graph/infrastructure/better-sqlite-knowledge-graph.repository';
import { ProjectKnowledgeBaseLinksService } from '../../infrastructure/sqlite/project-knowledge-base-links.service';
import { FileSotRepository } from '../../infrastructure/sotRepository';
import { FileOriginalDocumentRepository } from '../../infrastructure/fileOriginalDocumentRepository';
import { KnowledgePreparationFailure } from '../definitions/knowledgePreparationFailure';

/** 本插件资料准备的可失败边界；没有线程、向量进程或全局注册副作用。 */
export async function prepareKnowledgeData(storage: AdoptedHostData, projects: PluginProjectReadPort) {
  try {
    const paths = {
      sotDirectory: path.join(storage.dataDirectory, 'source_of_truth'),
      originalsDirectory: path.join(storage.dataDirectory, 'originals'),
      temporaryDirectory: path.join(storage.dataDirectory, 'temporary'),
      ...(isGraphExtractionDumpEnabled()
        ? { graphDebugDirectory: path.join(storage.dataDirectory, 'diagnostics', 'kg-extraction') }
        : {}),
    };
    await Promise.all(Object.values(paths).map(directory => mkdir(directory, { recursive: true })));
    const metadata = new BetterSqliteMetadataRepository(storage.database);
    // constructor 建默认记录；这里读取验证真实元数据，而不是发布一个尚不能工作的实例。
    if (!await metadata.getKnowledgeBaseById('default')) throw new Error('默认知识库元数据不可读取');
    return {
      paths, metadata,
      sot: new FileSotRepository(paths.sotDirectory),
      originals: new FileOriginalDocumentRepository(paths.originalsDirectory),
      graphRepository: new BetterSqliteKnowledgeGraphRepository(storage.database),
      links: new ProjectKnowledgeBaseLinksService(storage.database, metadata, projects),
    };
  } catch (cause) {
    throw new KnowledgePreparationFailure(cause);
  }
}
