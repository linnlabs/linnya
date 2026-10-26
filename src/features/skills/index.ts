import { getSkillsPath } from '../../shared/utils/pathManager';
import { discoverSkills, invalidateSkillCache } from './discovery';
import { createLocalSkillManagement } from './adapters/createLocalSkillManagement';

export { createLocalSkillManagement } from './adapters/createLocalSkillManagement';
export { SkillManagementError } from './definitions/skillManagement';
export type { SkillManagementPort } from './definitions/skillManagement';

export const skillManagement = createLocalSkillManagement({
  userRoot: getSkillsPath, catalog: discoverSkills, changed: invalidateSkillCache,
});
