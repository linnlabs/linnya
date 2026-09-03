import type { UserLoginEnvironmentCandidateSource } from './userLoginEnvironmentCandidate';

export interface ShellEnvironmentSnapshot {
  readonly kind: 'shell_environment_snapshot';
  readonly revision: string;
  readonly source: UserLoginEnvironmentCandidateSource;
  readonly entries: Readonly<Record<string, string>>;
}
