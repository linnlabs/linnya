import type { CustomCapabilityApiFormat } from '@app/schemas/custom-api-onboarding';

export function getCustomCapabilityAddressPresentation(format: CustomCapabilityApiFormat) {
  switch (format) {
    case 'openai_embeddings':
      return {
        example: 'https://api.example.com/v1',
        hint: '填写基础地址，调用时追加 /embeddings；不要重复填写接口路径。',
      };
    case 'cohere_rerank':
      return {
        example: 'https://api.cohere.com/v2',
        hint: '填写基础地址，调用时追加 /rerank；兼容网关请填写它实际使用的 /v1 或 /v2 地址。',
      };
    case 'openai_images_generations':
      return {
        example: 'https://api.example.com/v1',
        hint: '填写基础地址，调用时追加 /images/generations；服务需支持 b64_json 图片响应。',
      };
    case 'paddle_layout_parsing':
      return {
        example: 'https://example.com/layout-parsing',
        hint: '填写完整的 layout-parsing 接口地址，不会追加路径；使用 token 鉴权。',
      };
    case 'paddle_ocr_jobs':
      return {
        example: 'https://example.com',
        hint: '填写服务基础地址，调用时追加 /api/v2/ocr/jobs；使用 Bearer 鉴权。',
      };
  }
}
