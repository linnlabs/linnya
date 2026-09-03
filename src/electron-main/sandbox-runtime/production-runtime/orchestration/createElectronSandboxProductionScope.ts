import {
  createSandboxProductionScope,
  type CreateSandboxProductionScopeInput,
} from '../../../../app-hosts/linnya/adapters/sandbox/production-runtime';
import { createElectronSandboxUtilityProcessFork } from '../functions/createElectronSandboxUtilityProcessFork';

export type CreateElectronSandboxProductionScopeInput = Omit<
  CreateSandboxProductionScopeInput,
  'utilityProcessFork'
> & {
  readonly utilityProcessFork?: CreateSandboxProductionScopeInput['utilityProcessFork'];
};

/** Electron composition 只选择 UtilityProcess adapter，业务编排属于 App Host。 */
export function createElectronSandboxProductionScope(
  input: CreateElectronSandboxProductionScopeInput,
) {
  return createSandboxProductionScope({
    ...input,
    utilityProcessFork:
      input.utilityProcessFork ?? createElectronSandboxUtilityProcessFork(),
  });
}
