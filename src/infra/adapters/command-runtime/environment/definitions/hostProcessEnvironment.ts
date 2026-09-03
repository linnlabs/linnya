export interface HostProcessEnvironment {
  readonly kind: 'host_process_environment';
  readonly entries: Readonly<Record<string, string>>;
}
