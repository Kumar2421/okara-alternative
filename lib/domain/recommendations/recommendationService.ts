import type { Finding } from "@/lib/domain/findings/findingTypes";
import { deriveRecommendations } from "./recommendationRules";
import type { Recommendation } from "./recommendationTypes";

export function getFindingRecommendations(finding: Finding): Recommendation[] {
  return deriveRecommendations(finding);
}
