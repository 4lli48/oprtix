import { CONJUNCTION_SAFETY_THRESHOLD_METERS } from '../simulation/conjunctionService';

export interface TransparentRiskEvaluation {
  riskLevel: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NOMINAL';
  simulationRiskScore: number; // 0 to 100
  missDistanceMeters: number;
  safetyThresholdMeters: number;
  relativeVelocityKmS: number;
  kineticEnergyIndex: number;  // proxy relative energy
  formulaExplanation: string;
  isOperationalCertified: false;
}

/**
 * Computes transparent prototype risk score based on geometric miss distance
 * and relative encounter kinetic energy index.
 */
export function evaluateSimulationRisk(
  missDistanceMeters: number,
  relativeVelocityKmS: number
): TransparentRiskEvaluation {
  const threshold = CONJUNCTION_SAFETY_THRESHOLD_METERS; // 1000m
  // Kinetic energy proxy proportional to v_rel^2 (MJ/kg relative)
  const kineticEnergyIndex = Math.round(0.5 * relativeVelocityKmS * relativeVelocityKmS * 10) / 10;

  let riskScore = 0;
  let riskLevel: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NOMINAL' = 'NOMINAL';
  let formulaExplanation = '';

  if (missDistanceMeters < 500) {
    // Critical: Severe breach (< 500m)
    riskScore = Math.min(100, Math.round(85 + 15 * (1 - missDistanceMeters / 500)));
    riskLevel = 'CRITICAL';
    formulaExplanation = `Miss distance (${missDistanceMeters.toFixed(0)} m) is deep within inner red alert perimeter (<500 m) with high encounter energy (${kineticEnergyIndex} MJ/kg). Catastrophic collision risk.`;
  } else if (missDistanceMeters <= threshold) {
    // High: Inside 1.0 km safety threshold
    riskScore = Math.round(60 + 25 * (1 - (missDistanceMeters - 500) / 500));
    riskLevel = 'HIGH';
    formulaExplanation = `Miss distance (${missDistanceMeters.toFixed(0)} m) violates 1000 m safety threshold. Maneuver planning mandatory.`;
  } else if (missDistanceMeters <= 3500) {
    // Elevated: Inside 3.5 km monitor buffer
    riskScore = Math.round(20 + 35 * (1 - (missDistanceMeters - threshold) / 2500));
    riskLevel = 'ELEVATED';
    formulaExplanation = `Miss distance (${(missDistanceMeters / 1000).toFixed(2)} km) passes within tracking buffer zone. Trajectory monitoring advised.`;
  } else {
    // Nominal: Well clear
    riskScore = Math.max(5, Math.round(15 * Math.exp(-(missDistanceMeters - 3500) / 2000)));
    riskLevel = 'NOMINAL';
    formulaExplanation = `Miss distance (${(missDistanceMeters / 1000).toFixed(2)} km) exceeds safety perimeter. Zero intervention required.`;
  }

  return {
    riskLevel,
    simulationRiskScore: riskScore,
    missDistanceMeters,
    safetyThresholdMeters: threshold,
    relativeVelocityKmS,
    kineticEnergyIndex,
    formulaExplanation,
    isOperationalCertified: false,
  };
}
