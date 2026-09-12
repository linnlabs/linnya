import { slidesConsultingHighDensityCase } from './slidesConsultingHighDensity';
import { slidesConsultingEmbodiedIntelligenceCase } from './slidesConsultingEmbodiedIntelligence';
import { slidesConsultingCommercialSpaceCase } from './slidesConsultingCommercialSpace';
import { slidesConsultingEnergyStorageCase } from './slidesConsultingEnergyStorage';
import { slidesConsultingHumanoidRoboticsCase } from './slidesConsultingHumanoidRobotics';
import { slidesConsultingInnovativePharmaCase } from './slidesConsultingInnovativePharma';
import { slidesConsultingReferenceCase } from './slidesConsultingReference';
import { slidesDesignContractBaselineCase } from './slidesDesignContractBaseline';
import { slidesDesignContractIntentCase } from './slidesDesignContractIntent';
import { slidesArgFrontierComplexCase } from './slidesArgFrontierComplex';
import { slidesDataIntegrityStressCase } from './slidesDataIntegrityStress';

export const builtinBenchmarkCases = [
  slidesArgFrontierComplexCase,
  slidesDataIntegrityStressCase,
  slidesConsultingEmbodiedIntelligenceCase,
  slidesConsultingCommercialSpaceCase,
  slidesConsultingEnergyStorageCase,
  slidesConsultingHighDensityCase,
  slidesConsultingHumanoidRoboticsCase,
  slidesConsultingInnovativePharmaCase,
  slidesConsultingReferenceCase,
  slidesDesignContractBaselineCase,
  slidesDesignContractIntentCase,
] as const;
