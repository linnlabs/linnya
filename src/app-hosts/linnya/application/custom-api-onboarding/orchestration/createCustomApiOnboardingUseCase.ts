import type {
  CustomApiOnboardingUseCase,
  CustomApiOnboardingDependencies,
} from '../definitions/customApiOnboardingPorts';
import { removeCustomApiProvider } from './removeCustomApiProvider';
import { registerCustomApiModels } from './registerCustomApiModels';
import { refreshCustomApiProvider } from './refreshCustomApiProvider';
import { updateCustomApiProvider } from './updateCustomApiProvider';

export type CreateCustomApiOnboardingUseCaseDependencies = CustomApiOnboardingDependencies;

export function createCustomApiOnboardingUseCase(
  dependencies: CreateCustomApiOnboardingUseCaseDependencies
): CustomApiOnboardingUseCase {
  return Object.freeze<CustomApiOnboardingUseCase>({
    removeProvider: command => removeCustomApiProvider(command, dependencies),
    registerModel: command => registerCustomApiModels(command, dependencies),
    refreshProvider: command => refreshCustomApiProvider(command, dependencies),
    updateProvider: command => updateCustomApiProvider(command, dependencies),
  });
}
