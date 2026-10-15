import type {
  CustomApiFormat,
  CustomApiProviderUpdateRequest,
  CustomApiProviderUpdateResponse,
} from '@app/schemas/custom-api-onboarding';

/** 模型管理中当前自定义分组的连接事实，由 Host picker 快照投影。 */
export interface CustomApiProviderConnection {
  readonly providerName: string;
  readonly apiFormat?: CustomApiFormat;
  readonly baseUrl?: string;
}

/** 分组编辑表单；Key 只存在于未提交表单与一次 Host command 中。 */
export interface CustomApiProviderEditForm {
  providerName: string;
  customApiFormat: CustomApiFormat;
  baseUrl: string;
  credentialSecret: string;
}

export type CustomApiProviderEditIssue = 'provider_name_required' | 'base_url_invalid';

export type CustomApiProviderEditResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issue: CustomApiProviderEditIssue };

export interface CustomApiProviderEditGateway {
  updateProvider(request: CustomApiProviderUpdateRequest): Promise<CustomApiProviderUpdateResponse>;
}
