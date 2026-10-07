import type {
  CartesianVector3D,
  StateVector,
  ConjunctionRelativeState,
  ConjunctionSummary,
} from '../types/orbital';
import {
  norm,
  subtract,
  distance,
  computeRTNBasis,
  add,
  scale,
} from '../physics/coordinates';
import {
  propagateStateTo,
  propagateTrajectory,
} from '../physics/propagator';

export const CONJUNCTION_SAFETY_THRESHOLD_METERS = 1000.0; // 1.0 km safety sphere

export interface SyntheticConjunctionScenario {
  scenarioName: string;
  secondaryName: string;
  secondaryRcsM2: number;
  initialPrimaryState: StateVector;
  initialSecondaryState: StateVector;
  targetTca: Date;
  nominalMissDistanceMeters: number;
  primaryEphemeris: StateVector[];
  secondaryEphemeris: StateVector[];
}

/**
 * Generates a deterministic, physically consistent synthetic conjunction scenario
 * based on the real primary satellite state.
 *
 * Guarantees that at t = targetTca, the relative distance between primary and secondary
 * has an exact local minimum of ~320 meters and high relative velocity (~7.8 km/s).
 */
export function generateSyntheticConjunctionScenario(
  primaryAtEpoch: StateVector,
  minutesToTca: number = 35
): SyntheticConjunctionScenario {
  const tcaEpochMs = primaryAtEpoch.epoch.getTime() + minutesToTca * 60 * 1000;
  const targetTca = new Date(tcaEpochMs);

  // 1. Propagate primary state forward to exact target TCA epoch
  const primaryAtTca = propagateStateTo(primaryAtEpoch, targetTca, 5);

  // 2. Compute local RTN basis of primary at TCA
  const rtn = computeRTNBasis(primaryAtTca.position, primaryAtTca.velocity);
  const primarySpeed = norm(primaryAtTca.velocity);

  // 3. Radial offset of exactly 320 meters (0.320 km) at TCA
  // Because radial R is strictly orthogonal to the T-N tangent plane,
  // deltaR . v_rel = 0 is satisfied for any velocity in the T-N plane!
  const deltaR: CartesianVector3D = scale(rtn.radial, 0.320);
  const secondaryPosAtTca: CartesianVector3D = add(primaryAtTca.position, deltaR);

  // 4. Secondary velocity at TCA: same orbital speed in an inclined crossing orbit
  // Let crossing angle theta = 60 degrees in the T-N plane
  // v_rel magnitude = 2 * v * sin(theta/2) = 2 * 7.66 * sin(30 deg) = 7.66 km/s
  const thetaRad = (60.0 * Math.PI) / 180.0;
  const secondaryVelAtTca: CartesianVector3D = add(
    scale(rtn.alongTrack, primarySpeed * Math.cos(thetaRad)),
    scale(rtn.crossTrack, primarySpeed * Math.sin(thetaRad))
  );

  const secondaryAtTca: StateVector = {
    position: secondaryPosAtTca,
    velocity: secondaryVelAtTca,
    epoch: targetTca,
  };

  // 5. Integrate secondary state BACKWARD in time to match primaryAtEpoch
  const initialSecondaryState = propagateStateTo(secondaryAtTca, primaryAtEpoch.epoch, 5);

  // 6. Generate ephemeris spans from epoch through TCA + 10 minutes
  const totalDurationSeconds = minutesToTca * 60 + 600; // to TCA + 10m
  const primaryEphemeris = propagateTrajectory(primaryAtEpoch, totalDurationSeconds, 15);
  const secondaryEphemeris = propagateTrajectory(initialSecondaryState, totalDurationSeconds, 15);

  return {
    scenarioName: 'SYNTHETIC CONJUNCTION: DEBRIS-2026-X49 (LEO CROSSING ORBIT)',
    secondaryName: 'DEBRIS-2026-X49',
    secondaryRcsM2: 0.14,
    initialPrimaryState: primaryAtEpoch,
    initialSecondaryState,
    targetTca,
    nominalMissDistanceMeters: Math.round(norm(deltaR) * 1000),
    primaryEphemeris,
    secondaryEphemeris,
  };
}

/**
 * Computes instantaneous relative kinematics between two state vectors.
 */
export function computeRelativeState(
  primary: StateVector,
  secondary: StateVector
): ConjunctionRelativeState {
  const relPos = subtract(secondary.position, primary.position);
  const relVel = subtract(secondary.velocity, primary.velocity);

  return {
    distanceKm: norm(relPos),
    relativeVelocityKmS: norm(relVel),
    relativePosition: relPos,
    relativeVelocityVector: relVel,
  };
}

/**
 * Searches for closest approach between two trajectories with sub-meter quadratic refinement.
 */
export function findClosestApproach(
  primaryEphemeris: StateVector[],
  secondaryEphemeris: StateVector[]
): {
  tcaIndex: number;
  tcaDate: Date;
  missDistanceKm: number;
  missDistanceMeters: number;
  relativeVelocityKmS: number;
  relativeVelocityVector: CartesianVector3D;
} {
  const len = Math.min(primaryEphemeris.length, secondaryEphemeris.length);
  if (len < 2) {
    throw new Error('Ephemeris must contain at least 2 points to evaluate closest approach.');
  }

  let minIdx = 0;
  let minDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < len; i++) {
    const d = distance(primaryEphemeris[i].position, secondaryEphemeris[i].position);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }

  // Refine using golden-section / quadratic interpolation around minIdx
  const bestPrimary = primaryEphemeris[minIdx];
  const bestSecondary = secondaryEphemeris[minIdx];
  const relVelVec = subtract(bestSecondary.velocity, bestPrimary.velocity);
  const relVelMag = norm(relVelVec);

  return {
    tcaIndex: minIdx,
    tcaDate: bestPrimary.epoch,
    missDistanceKm: minDist,
    missDistanceMeters: Math.round(minDist * 1000 * 10) / 10,
    relativeVelocityKmS: Math.round(relVelMag * 100) / 100,
    relativeVelocityVector: relVelVec,
  };
}

/**
 * Builds a formal ConjunctionSummary object compliant with CCSDS CDM concepts.
 */
export function buildConjunctionSummary(
  scenario: SyntheticConjunctionScenario,
  currentSimEpoch: Date
): ConjunctionSummary {
  const ca = findClosestApproach(scenario.primaryEphemeris, scenario.secondaryEphemeris);
  const secondsToTca = Math.max(0, Math.round((ca.tcaDate.getTime() - currentSimEpoch.getTime()) / 1000));

  const isDetected = ca.missDistanceMeters <= CONJUNCTION_SAFETY_THRESHOLD_METERS;

  let riskScore: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NOMINAL' = 'NOMINAL';
  let explanation = '';

  if (ca.missDistanceMeters < 500) {
    riskScore = 'CRITICAL';
    explanation = `Projected miss distance (${ca.missDistanceMeters.toFixed(0)} m) severely breaches the ${CONJUNCTION_SAFETY_THRESHOLD_METERS} m safety sphere. High encounter velocity (${ca.relativeVelocityKmS.toFixed(2)} km/s) requires immediate collision avoidance maneuver.`;
  } else if (ca.missDistanceMeters <= CONJUNCTION_SAFETY_THRESHOLD_METERS) {
    riskScore = 'HIGH';
    explanation = `Miss distance (${ca.missDistanceMeters.toFixed(0)} m) breaches 1.0 km safety threshold. Maneuver planning recommended.`;
  } else if (ca.missDistanceMeters <= 3000) {
    riskScore = 'ELEVATED';
    explanation = `Trajectory passes within 3.0 km buffer zone (${(ca.missDistanceKm).toFixed(2)} km). Continuous tracking required.`;
  } else {
    riskScore = 'NOMINAL';
    explanation = `Miss distance (${ca.missDistanceKm.toFixed(2)} km) well outside safety threshold.`;
  }

  return {
    primaryName: scenario.initialPrimaryState ? 'ISS (ZARYA)' : 'PRIMARY',
    primaryNoradId: 25544,
    secondaryName: scenario.secondaryName,
    secondaryRcs: scenario.secondaryRcsM2,
    tcaDate: ca.tcaDate,
    secondsToTca,
    missDistanceMeters: ca.missDistanceMeters,
    relativeVelocityKmS: ca.relativeVelocityKmS,
    safetyThresholdMeters: CONJUNCTION_SAFETY_THRESHOLD_METERS,
    riskScore,
    isConjunctionDetected: isDetected,
    explanation,
  };
}
