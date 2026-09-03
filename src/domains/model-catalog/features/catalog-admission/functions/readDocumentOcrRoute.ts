import { DocumentOcrRouteSchema, type DocumentOcrRoute } from '@app/schemas/document-ocr';

export function readDocumentOcrRoute(
  value: unknown,
  source: {
    modelName: string;
    hasDocumentOcrCapability: boolean;
  }
): DocumentOcrRoute | undefined {
  if (value === undefined || value === null) {
    if (source.hasDocumentOcrCapability) {
      throw new Error('[ModelConfigProcessor] document_ocr 模型必须声明 document_ocr_route。');
    }
    return undefined;
  }
  if (!source.hasDocumentOcrCapability) {
    throw new Error(
      '[ModelConfigProcessor] 只有声明 document_ocr capability 的模型才能配置 document_ocr_route。'
    );
  }

  const result = DocumentOcrRouteSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length
      ? `document_ocr_route.${issue.path.join('.')}`
      : 'document_ocr_route';
    throw new Error(`[ModelConfigProcessor] ${field} 无效：${issue?.message ?? '未知错误'}。`);
  }
  if (result.data.endpoint_model_id !== source.modelName) {
    throw new Error(
      '[ModelConfigProcessor] document_ocr_route.endpoint_model_id 必须与 model_name 一致。'
    );
  }
  return result.data;
}
