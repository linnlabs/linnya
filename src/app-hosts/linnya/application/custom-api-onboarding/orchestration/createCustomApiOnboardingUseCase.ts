import { updateCustomCapabilityProvider } from './updateCustomCapabilityProvider';
import type {
  CustomApiOnboardingUseCase,
  CustomApiOnboardingDependencies,
} from '../definitions/customApiOnboardingPorts';
import { removeCustomApiProvider } from './removeCustomApiProvider';
import { registerCustomApiModels } from './registerCustomApiModels';
import { refreshCustomApiProvider } from './refreshCustomApiProvider';
import { updateCustomApiProvider } from './updateCustomApiProvider';
import { registerCustomCapabilityModel } from './registerCustomCapabilityModel';
import { testCustomCapabilityModel } from './testCustomCapabilityModel';

export type CreateCustomApiOnboardingUseCaseDependencies = CustomApiOnboardingDependencies;

export function createCustomApiOnboardingUseCase(
  dependencies: CreateCustomApiOnboardingUseCaseDependencies
): CustomApiOnboardingUseCase {
  return Object.freeze<CustomApiOnboardingUseCase>({
    updateCapabilityProvider: command => updateCustomCapabilityProvider(command, dependencies),
    registerCapabilityModel: command => registerCustomCapabilityModel(command, dependencies),
    testCapabilityModel: (command, signal) => testCustomCapabilityModel(command, signal),
    removeProvider: command => removeCustomApiProvider(command, dependencies),
    registerModel: command => registerCustomApiModels(command, dependencies),
    refreshProvider: command => refreshCustomApiProvider(command, dependencies),
    updateProvider: command => updateCustomApiProvider(command, dependencies),
  });
}
