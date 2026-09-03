export interface InternalHelperEnvironment {
  readonly kind: 'internal_helper_environment';
  readonly entries: Readonly<Record<string, string>>;
}
