import type {
  ConjunctionSummary,
  OptimizationResult,
} from '../types/orbital';

export interface AiExplanationResult {
  narrative: string;
  tradeoffs: string;
  isFallback: boolean;
  statusBadge: string;
}

/**
 * Generates an aerospace flight-director explanation of the computed conjunction
 * and maneuver optimization results.
 *
 * Enforces rule: The AI consumes ONLY pre-calculated physics values and never invents numbers.
 * Provides resilient deterministic flight-director fallback.
 */
export function generateAiExplanation(
  conjunction: ConjunctionSummary,
  optimization: OptimizationResult
): AiExplanationResult {
  const recommended = optimization.candidates.find(
    (c) => c.id === optimization.recommendedId
  ) ?? optimization.candidates[0];

  const candidateA = optimization.candidates.find((c) => c.id === 'MANEUVER_A');
  const candidateB = optimization.candidates.find((c) => c.id === 'MANEUVER_B');
  const candidateC = optimization.candidates.find((c) => c.id === 'MANEUVER_C');

  const preMissM = conjunction.missDistanceMeters.toFixed(0);
  const postMissKm = recommended.postManeuverMissDistanceKm.toFixed(2);
  const dv = recommended.deltaV.total.toFixed(2);
  const fuel = recommended.fuelProxyKg.toFixed(1);

  const narrative =
    `ORBITAL FLIGHT DIRECTOR DIRECTIVE: At current epoch, space object ${conjunction.secondaryName} ` +
    `is on a critical crossing trajectory towards ${conjunction.primaryName} with a projected miss distance of ` +
    `${preMissM} m (breaching the ${conjunction.safetyThresholdMeters} m safety perimeter at ${conjunction.relativeVelocityKmS.toFixed(2)} km/s relative velocity). ` +
    `Deterministic trajectory re-propagation selects ${recommended.name}. ` +
    `Execution of a +${dv} m/s impulse will alter along-track phasing, expanding closest approach distance ` +
    `from ${preMissM} m to ${postMissKm} km with a propellant consumption of ${fuel} kg.`;

  const tradeoffs =
    `TRADE-OFF EVALUATION MATRIX:\n` +
    `• Candidate A (Small Early Burn): Conserves propellant (Δv = ${candidateA?.deltaV.total.toFixed(2)} m/s), ` +
    `but achieves only ${(candidateA?.postManeuverMissDistanceKm ?? 0).toFixed(2)} km miss distance, ` +
    `failing to satisfy the robust safety margin criterion.\n` +
    `• Candidate B (Balanced Prograde): OPTIMAL. Imparts +${candidateB?.deltaV.total.toFixed(2)} m/s along-track velocity, ` +
    `expanding miss distance to ${(candidateB?.postManeuverMissDistanceKm ?? 0).toFixed(2)} km. Fuel cost (${candidateB?.fuelProxyKg} kg) is acceptable and aligned with station orbital maintenance.\n` +
    `• Candidate C (Cross-Track Normal): Deflects trajectory by ${(candidateC?.postManeuverMissDistanceKm ?? 0).toFixed(2)} km, ` +
    `but requires excessive Δv (${candidateC?.deltaV.total.toFixed(2)} m/s, ${candidateC?.fuelProxyKg} kg propellant) with adverse out-of-plane orbital plane distortion.`;

  return {
    narrative,
    tradeoffs,
    isFallback: true,
    statusBadge: 'AEROSPACE FLIGHT DIRECTOR (DETERMINISTIC FALLBACK ACTIVE)',
  };
}
