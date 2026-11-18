// 用受控 Worker 生产者验证 CLI/队列/图谱编排；真实解析与向量写由安装态 E2E 验收。
import { parentPort, workerData } from 'node:worker_threads';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { openPluginWorkerDatabase } from '@plugin/backend/worker/databaseRuntime';
import { createPluginWorkerInferencePort } from '@plugin/backend/worker/inferenceRuntime';

async function main() {
  const input: unknown = workerData;
  const job = z
    .object({
      kbId: z.string(),
      docId: z.string(),
      filename: z.string().optional(),
      filePath: z.string().optional(),
      embeddingModelId: z.string().optional(),
      llmModelId: z.string().optional(),
      runtime: z.object({ sotDirectory: z.string() }),
    })
    .parse(input);
  const database = openPluginWorkerDatabase();
  const inference = createPluginWorkerInferencePort();
  try {
    if (job.filename) {
      if (!job.embeddingModelId || !job.filePath) throw new Error('Invalid ingestion fixture');
      const vectors = await inference.embedding.embed({
        modelId: job.embeddingModelId,
        values: [job.filename],
      });
      await mkdir(job.runtime.sotDirectory, { recursive: true });
      await writeFile(
        path.join(job.runtime.sotDirectory, `${job.docId}.source.json`),
        JSON.stringify({
          doc_id: job.docId,
          doc_title: job.filename,
          metadata: {},
          content_blocks: { paragraph: { block_type: 'paragraph', text: job.filename } },
          structure: { root: ['paragraph'] },
        })
      );
      database
        .prepare('UPDATE knowledge_bases SET embedding_model_id=?,embedding_space_id=? WHERE id=?')
        .run(job.embeddingModelId, vectors.spaceId, job.kbId);
      database.prepare("UPDATE kb_documents SET status='completed' WHERE id=?").run(job.docId);
      await rm(job.filePath);
    } else if (job.llmModelId) {
      await inference.textGeneration.generate({
        modelId: job.llmModelId,
        messages: [{ role: 'system', content: job.docId }],
      });
      database
        .prepare("INSERT OR REPLACE INTO knowledge_graph_doc_status VALUES (?,?,1,1,'completed',?)")
        .run(job.kbId, job.docId, Date.now() / 1000);
    } else {
      if (!job.embeddingModelId) throw new Error('Invalid indexing fixture');
      await inference.embedding.embed({ modelId: job.embeddingModelId, values: ['graph-vector'] });
      database
        .prepare(
          "INSERT OR REPLACE INTO knowledge_graph_vector_doc_status VALUES (?,?,?,1,0,1,'completed',NULL,?)"
        )
        .run(job.kbId, job.docId, job.embeddingModelId, Date.now() / 1000);
    }
    parentPort?.postMessage({
      type: 'completed',
      result: {
        kbId: job.kbId,
        docId: job.docId,
        complete: true,
        frontendState: { doc_id: job.docId },
      },
    });
  } catch (error) {
    if (job.llmModelId)
      database
        .prepare("UPDATE knowledge_graph_doc_status SET status='failed' WHERE kb_id=? AND doc_id=?")
        .run(job.kbId, job.docId);
    parentPort?.postMessage({
      type: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    inference.dispose();
    database.close();
    parentPort?.close();
  }
}
void main();
