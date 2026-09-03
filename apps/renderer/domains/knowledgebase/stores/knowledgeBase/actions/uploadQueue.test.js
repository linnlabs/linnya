import { describe, expect, it, vi } from 'vitest'

import { UPLOAD_STATUS } from '../../../constants/index.js'
import { knowledgeBaseService } from '../../../services/knowledgeBaseService.js'
import { createPerformUpload } from './uploadQueue.js'

vi.mock('../../../services/knowledgeBaseService.js', () => ({
  knowledgeBaseService: {
    uploadDocument: vi.fn(),
  },
}))

vi.mock('@/domains/model-configuration', () => ({
  readEffectiveModelPurposeBinding: (slot) => ({
    embedding: 'embedding-model',
    rerank: 'rerank-model',
    pdf_ocr: 'pdf-ocr-model',
    image_vision: 'image-vision-model',
  })[slot] ?? null,
  readEffectiveAuxiliaryModelPurposeBinding: vi.fn(() => 'graph-model'),
}))

describe('knowledge base upload model config', () => {
  it('uses global model snapshot during upload instead of per-KB model fields', async () => {
    knowledgeBaseService.uploadDocument.mockResolvedValue({
      status: 'pending',
      document: { id: 'doc-1' },
      task_id: 'task-1',
    })

    const task = {
      id: 'upload-1',
      kbId: 'kb-1',
      file: new File(['pdf'], 'source.pdf', { type: 'application/pdf' }),
      filename: 'source.pdf',
      status: UPLOAD_STATUS.PENDING,
    }
    const state = {
      knowledgeBases: {
        value: [
          {
            id: 'kb-1',
            embeddingModelId: 'old-kb-embedding-model',
            rerankModelId: 'old-kb-rerank-model',
            pdfOcrModelId: 'old-kb-pdf-ocr-model',
            imageVisionModelId: 'old-kb-image-vision-model',
            visionModelId: 'old-kb-vision-model',
          },
        ],
      },
      parsingSettings: { forceVisionMode: false },
      uploadTasks: new Map([[task.id, task]]),
      currentKbId: { value: null },
      documents: { value: [] },
    }
    const updateTaskState = vi.fn()

    const performUpload = createPerformUpload(
      state,
      updateTaskState,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    )

    await performUpload(task)

    expect(knowledgeBaseService.uploadDocument).toHaveBeenCalledWith(
      'kb-1',
      task.file,
      expect.objectContaining({
        embedding_model_id: 'embedding-model',
        rerank_model_id: 'rerank-model',
        pdf_ocr_model_id: 'pdf-ocr-model',
        image_vision_model_id: 'image-vision-model',
        graph_extraction_model_id: 'graph-model',
        vision_model_id: null,
      }),
      expect.any(Function),
    )
  })
})
