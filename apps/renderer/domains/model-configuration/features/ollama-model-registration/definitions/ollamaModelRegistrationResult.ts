export type OllamaModelRegistrationIssue =
  | 'endpoint_model_id_required'
  | 'service_url_invalid'
  | 'token_limits_invalid';

export type OllamaModelRegistrationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issue: OllamaModelRegistrationIssue };
