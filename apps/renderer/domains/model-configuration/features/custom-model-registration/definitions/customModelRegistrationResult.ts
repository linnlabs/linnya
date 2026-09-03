export type CustomModelRegistrationIssue =
  | 'endpoint_model_id_required'
  | 'base_url_invalid'
  | 'token_limits_invalid';

export type CustomModelRegistrationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issue: CustomModelRegistrationIssue };
