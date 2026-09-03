import type {
  UserLoginEnvironmentCandidate,
  UserLoginEnvironmentCandidateSource,
} from '../definitions';

export function createUserLoginEnvironmentCandidate(input: {
  readonly source: UserLoginEnvironmentCandidateSource;
  readonly entries: Readonly<Record<string, string>>;
}): UserLoginEnvironmentCandidate {
  return Object.freeze({
    kind: 'user_login_environment_candidate',
    source: input.source,
    entries: Object.freeze(Object.fromEntries(Object.entries(input.entries))),
  });
}
