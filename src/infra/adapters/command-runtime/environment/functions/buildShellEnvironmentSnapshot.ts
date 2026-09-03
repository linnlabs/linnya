import type {
  HostProcessEnvironment,
  ShellEnvironmentSnapshot,
  UserLoginEnvironmentCandidate,
} from '../definitions';
import { mergeEnvironmentEntries } from './mergeEnvironmentEntries';

export function buildShellEnvironmentSnapshot(input: {
  readonly host: HostProcessEnvironment;
  readonly candidate: UserLoginEnvironmentCandidate;
  readonly revision: string;
}): ShellEnvironmentSnapshot {
  const entries = mergeEnvironmentEntries(input.host.entries, input.candidate.entries);
  return Object.freeze({
    kind: 'shell_environment_snapshot',
    revision: input.revision,
    source: input.candidate.source,
    // D68/A 要求忠实冻结用户来源；PATH 缺失也是宿主事实，不能伪造另一套查找路径。
    entries,
  });
}
