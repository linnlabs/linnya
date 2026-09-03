import {
  PRESENTATION_BUILD_FAILURE_CODES,
  type PresentationBuildFailureCode,
} from '../definitions/presentationBuildFailure';

export function readPresentationBuildFailureCode(
  value: string | null
): PresentationBuildFailureCode | null {
  if (value === null) return null;
  return PRESENTATION_BUILD_FAILURE_CODES.find(code => code === value) ?? null;
}
