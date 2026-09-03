import { slidesConsultingHighDensityCase } from './slidesConsultingHighDensity';
import { slidesConsultingCommercialSpaceCase } from './slidesConsultingCommercialSpace';
import { slidesConsultingEnergyStorageCase } from './slidesConsultingEnergyStorage';
import { slidesConsultingHumanoidRoboticsCase } from './slidesConsultingHumanoidRobotics';
import { slidesConsultingInnovativePharmaCase } from './slidesConsultingInnovativePharma';
import { slidesConsultingReferenceCase } from './slidesConsultingReference';
import { slidesDesignContractBaselineCase } from './slidesDesignContractBaseline';
import { slidesDesignContractIntentCase } from './slidesDesignContractIntent';

export const builtinBenchmarkCases = [
  slidesConsultingCommercialSpaceCase,
  slidesConsultingEnergyStorageCase,
  slidesConsultingHighDensityCase,
  slidesConsultingHumanoidRoboticsCase,
  slidesConsultingInnovativePharmaCase,
  slidesConsultingReferenceCase,
  slidesDesignContractBaselineCase,
  slidesDesignContractIntentCase,
] as const;
