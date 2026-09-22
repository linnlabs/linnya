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
import { deepResearchArticleCase } from './deepResearchArticle';

export const builtinBenchmarkCases = [
  deepResearchArticleCase,
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
