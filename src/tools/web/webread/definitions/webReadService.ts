import type { WebReadCredentialReaderId } from './webReadConfig';

/** Web Read 自己拥有的外部解析服务定义，不属于模型目录或模型 Provider。 */
export interface WebReadServiceDefinition {
  readonly id: WebReadCredentialReaderId;
  readonly baseUrl: string;
  readonly environmentVariable: string;
}

/** 单次托管读取请求所需的最小服务配置。 */
export interface WebReadServiceRequest {
  readonly serviceId: WebReadCredentialReaderId;
  readonly baseUrl: string;
  readonly apiKey: string;
}

export const WEB_READ_SERVICE_DEFINITIONS: Readonly<
  Record<WebReadCredentialReaderId, WebReadServiceDefinition>
> = Object.freeze({
  metaso_reader: Object.freeze({
    id: 'metaso_reader',
    baseUrl: 'https://metaso.cn/api/v1',
    environmentVariable: 'METASO_READER_API_KEY',
  }),
  jina_reader: Object.freeze({
    id: 'jina_reader',
    baseUrl: 'https://r.jina.ai',
    environmentVariable: 'JINA_API_KEY',
  }),
});
