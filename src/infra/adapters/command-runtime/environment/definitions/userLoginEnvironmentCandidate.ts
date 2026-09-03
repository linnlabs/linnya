export type UserLoginEnvironmentCandidateSource =
  | 'macos_login_shell'
  | 'host_process';

export interface UserLoginEnvironmentCandidate {
  readonly kind: 'user_login_environment_candidate';
  readonly source: UserLoginEnvironmentCandidateSource;
  readonly entries: Readonly<Record<string, string>>;
}
