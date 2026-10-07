import type {
  ManeuverCandidate,
  StateVector,
  CartesianVector3D,
} from '../types/orbital';
import {
  rtnToEciDeltaV,
  add,
} from '../physics/coordinates';
import {
  propagateStateTo,
  propagateTrajectory,
} from '../physics/propagator';
import {
  findClosestApproach,
  CONJUNCTION_SAFETY_THRESHOLD_METERS,
  type SyntheticConjunctionScenario,
} from './conjunctionService';

export interface SimulatedManeuverCandidate extends ManeuverCandidate {
  trajectory: StateVector[];
}

// Spacecraft Propulsion Constants
const DEFAULT_SPACECRAFT_MASS_KG = 420000; // ISS mass approx ~420 metric tons
const PROPULSION_ISP_SECONDS = 305;         // Hydrazine/UDMH hypergolic thrusters
const G0_ACCEL = 9.80665;                   // m/s^2

/**
 * Calculates fuel/propellant consumption proxy using Tsiolkovsky Rocket Equation:
 * delta_m = m_0 * (1 - exp(-delta_v / (Isp * g0)))
 */
export function calculatePropellantMassKg(
  deltaV_m_s: number,
  massInitialKg: number = DEFAULT_SPACECRAFT_MASS_KG,
  ispSeconds: number = PROPULSION_ISP_SECONDS
): number {
  if (deltaV_m_s <= 0) return 0;
  const exhaustVelocity = ispSeconds * G0_ACCEL; // m/s
  const massRatio = Math.exp(-deltaV_m_s / exhaustVelocity);
  const propellantUsed = massInitialKg * (1 - massRatio);
  return Math.round(propellantUsed * 10) / 10;
}

/**
 * Simulates a specific CAM (Collision Avoidance Maneuver) delta-V vector,
 * re-propagating the resulting perturbed trajectory and evaluating post-maneuver closest approach.
 */
export function simulateManeuver(
  scenario: SyntheticConjunctionScenario,
  id: 'MANEUVER_A' | 'MANEUVER_B' | 'MANEUVER_C' | 'MANEUVER_D',
  name: string,
  description: string,
  burnOffsetMinutesBeforeTca: number,
  deltaV_RTN_m_s: { radial: number; alongTrack: number; crossTrack: number },
  missionImpact: 'LOW' | 'MODERATE' | 'HIGH'
): SimulatedManeuverCandidate {
  const tcaMs = scenario.targetTca.getTime();
  const burnEpoch = new Date(tcaMs - burnOffsetMinutesBeforeTca * 60 * 1000);

  // 1. Propagate primary state to burn epoch
  const stateAtBurn = propagateStateTo(scenario.initialPrimaryState, burnEpoch, 5);

  // 2. Convert RTN delta-V into ECI inertial frame
  const dV_ECI_km_s: CartesianVector3D = rtnToEciDeltaV(
    stateAtBurn.position,
    stateAtBurn.velocity,
    deltaV_RTN_m_s
  );

  // 3. Apply instantaneous delta-V: v_new = v_old + delta_v
  const postBurnVelocity = add(stateAtBurn.velocity, dV_ECI_km_s);
  const postBurnState: StateVector = {
    position: { ...stateAtBurn.position },
    velocity: postBurnVelocity,
    epoch: burnEpoch,
  };

  // 4. Propagate the post-maneuver trajectory past TCA (burn + 25 minutes)
  const propagationDurationSeconds = burnOffsetMinutesBeforeTca * 60 + 600;
  const postManeuverEphemeris = propagateTrajectory(postBurnState, propagationDurationSeconds, 15);

  // 5. Evaluate new closest approach relative to the secondary debris
  const burnEpochMs = burnEpoch.getTime();
  const relevantSecondaryEphemeris = scenario.secondaryEphemeris.filter(
    (pt) => pt.epoch.getTime() >= burnEpochMs
  );

  const newCa = findClosestApproach(postManeuverEphemeris, relevantSecondaryEphemeris);
  const totalDeltaV = Math.sqrt(
    deltaV_RTN_m_s.radial ** 2 +
    deltaV_RTN_m_s.alongTrack ** 2 +
    deltaV_RTN_m_s.crossTrack ** 2
  );

  const fuelProxyKg = calculatePropellantMassKg(totalDeltaV);
  const safetyPassed = newCa.missDistanceMeters >= CONJUNCTION_SAFETY_THRESHOLD_METERS;

  const safetyMarginScore = Math.min(100, (newCa.missDistanceMeters / CONJUNCTION_SAFETY_THRESHOLD_METERS) * 20);
  const deltaVEfficiencyScore = Math.max(0, 100 - totalDeltaV * 22);
  const missionImpactScore = missionImpact === 'LOW' ? 90 : missionImpact === 'MODERATE' ? 75 : 40;
  const compositeScore = 0.45 * safetyMarginScore + 0.35 * deltaVEfficiencyScore + 0.20 * missionImpactScore;

  return {
    id,
    name,
    description,
    burnEpoch,
    deltaV: {
      radial: deltaV_RTN_m_s.radial,
      alongTrack: deltaV_RTN_m_s.alongTrack,
      crossTrack: deltaV_RTN_m_s.crossTrack,
      total: Math.round(totalDeltaV * 100) / 100,
    },
    deltaVVectorECI: dV_ECI_km_s,
    postManeuverMissDistanceKm: Math.round(newCa.missDistanceKm * 100) / 100,
    postManeuverTcaSeconds: Math.round((newCa.tcaDate.getTime() - burnEpoch.getTime()) / 1000),
    fuelProxyKg,
    missionImpact,
    safetyPassed,
    score: Math.round(compositeScore * 10) / 10,
    scoreBreakdown: {
      safetyMarginScore: Math.round(safetyMarginScore),
      deltaVEfficiencyScore: Math.round(deltaVEfficiencyScore),
      missionImpactScore,
    },
    trajectory: postManeuverEphemeris,
  };
}
