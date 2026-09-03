import { registerSettingsContribution } from '@/domains/settings/public';
import { SYSTEM_MESSAGE_FALLBACKS } from '../../definitions/systemMessageCatalog';
import { installProcessMemoryObservationDevApi } from './orchestration/installProcessMemoryObservationDevApi';
import ProcessMemoryObservationSettingsPage from './ui/ProcessMemoryObservationSettingsPage.vue';
import './ui/process-memory-observation.css';

let registered = false;

export function ensureProcessMemoryObservationRegistered(): void {
  if (registered || !import.meta.env.DEV) return;
  registerSettingsContribution({
    id: 'process-memory-observation',
    title: SYSTEM_MESSAGE_FALLBACKS['system.memoryDiagnostics.title'],
    titleMessageKey: 'system.memoryDiagnostics.title',
    group: 'general',
    order: 80,
    component: ProcessMemoryObservationSettingsPage,
    isAvailable: () => import.meta.env.DEV,
  });
  installProcessMemoryObservationDevApi();
  registered = true;
}
