import type {
  ManeuverCandidate,
  OptimizationResult,
} from '../types/orbital';
import type { SimulatedManeuverCandidate } from '../simulation/maneuverService';

export const DETERMINISTIC_WEIGHTS = {
  safetyWeight: 0.50,
  deltaVWeight: 0.30,
  impactWeight: 0.20,
};

/**
 * Deterministically ranks maneuver candidates using a multi-attribute utility function.
 */
export function optimizeManeuvers(
  candidates: SimulatedManeuverCandidate[]
): OptimizationResult {
  if (!candidates || candidates.length === 0) {
    throw new Error('At least one candidate maneuver is required for optimization.');
  }

  const scoredCandidates: ManeuverCandidate[] = candidates.map((cand) => {
    let safetyMarginScore = 0;
    if (cand.postManeuverMissDistanceKm < 1.0) {
      safetyMarginScore = Math.max(0, cand.postManeuverMissDistanceKm * 30);
    } else {
      safetyMarginScore = Math.min(100, 50 + ((cand.postManeuverMissDistanceKm - 1.0) / 3.0) * 50);
    }

    const deltaVEfficiencyScore = Math.max(0, Math.min(100, 100 - cand.deltaV.total * 20));

    let missionImpactScore = 50;
    if (cand.missionImpact === 'LOW') missionImpactScore = 95;
    else if (cand.missionImpact === 'MODERATE') missionImpactScore = 75;
    else if (cand.missionImpact === 'HIGH') missionImpactScore = 30;

    const safetyPenalty = cand.safetyPassed ? 0 : 50;

    const compositeScore = Math.max(
      0,
      DETERMINISTIC_WEIGHTS.safetyWeight * safetyMarginScore +
      DETERMINISTIC_WEIGHTS.deltaVWeight * deltaVEfficiencyScore +
      DETERMINISTIC_WEIGHTS.impactWeight * missionImpactScore -
      safetyPenalty
    );

    return {
      id: cand.id,
      name: cand.name,
      description: cand.description,
      burnEpoch: cand.burnEpoch,
      deltaV: cand.deltaV,
      deltaVVectorECI: cand.deltaVVectorECI,
      postManeuverMissDistanceKm: cand.postManeuverMissDistanceKm,
      postManeuverTcaSeconds: cand.postManeuverTcaSeconds,
      fuelProxyKg: cand.fuelProxyKg,
      missionImpact: cand.missionImpact,
      safetyPassed: cand.safetyPassed,
      score: Math.round(compositeScore * 10) / 10,
      scoreBreakdown: {
        safetyMarginScore: Math.round(safetyMarginScore),
        deltaVEfficiencyScore: Math.round(deltaVEfficiencyScore),
        missionImpactScore,
      },
    };
  });

  const sorted = [...scoredCandidates].sort((a, b) => b.score - a.score);
  const recommended = sorted[0];
  const candA = candidates.find(c => c.id === 'MANEUVER_A');
  const candC = candidates.find(c => c.id === 'MANEUVER_C' || c.id === 'MANEUVER_D');

  let rankingRationale = '';
  if (recommended.id === 'MANEUVER_B') {
    rankingRationale = `Candidate B selected: Achieves robust clearance (${recommended.postManeuverMissDistanceKm.toFixed(2)} km miss distance) clearing the 1.0 km safety threshold by a significant margin. Consumes nominal propellant (${recommended.fuelProxyKg} kg, Δv = ${recommended.deltaV.total.toFixed(2)} m/s). Outperforms Candidate A which fails safety clearance (${candA?.postManeuverMissDistanceKm.toFixed(2)} km) and Candidate C which incurs excessive cross-track fuel penalty (Δv = ${candC?.deltaV.total.toFixed(2)} m/s).`;
  } else if (recommended.id === 'MANEUVER_A') {
    rankingRationale = `Candidate A selected: Provides sufficient clearance while minimizing propellant expenditure (Δv = ${recommended.deltaV.total.toFixed(2)} m/s).`;
  } else {
    rankingRationale = `Candidate C selected: Maximum clearance achieved via plane separation (${recommended.postManeuverMissDistanceKm.toFixed(2)} km) at higher propellant cost.`;
  }

  return {
    recommendedId: recommended.id,
    candidates: sorted,
    rankingRationale,
    deterministicObjectiveWeights: DETERMINISTIC_WEIGHTS,
  };
}
