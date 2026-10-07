import { describe, it, expect } from 'vitest';
import {
  simulateManeuver,
  calculatePropellantMassKg,
} from './maneuverService';
import { generateSyntheticConjunctionScenario } from './conjunctionService';
import type { StateVector } from '../types/orbital';

describe('Maneuver Simulation Engine - Phase 4 Verification', () => {
  const baseState: StateVector = {
    position: { x: 3348.35, y: 2941.57, z: -5136.15 },
    velocity: { x: -3.39, y: 6.67, z: 1.60 },
    epoch: new Date('2026-10-06T12:00:00Z'),
  };

  it('should calculate propellant consumption using rocket equation', () => {
    // For ISS (420,000 kg), Isp = 305 s
    // deltaV = 1.0 m/s => delta_m ~ 420000 * (1 - exp(-1 / (305 * 9.80665))) ~ 140.3 kg
    const fuel1 = calculatePropellantMassKg(1.0);
    expect(fuel1).toBeGreaterThan(130);
    expect(fuel1).toBeLessThan(150);

    const fuel0 = calculatePropellantMassKg(0);
    expect(fuel0).toBe(0);
  });

  it('should generate exactly 3 candidate maneuvers with distinct delta-V', () => {
    const scenario = generateSyntheticConjunctionScenario(baseState, 30);
    const candA = simulateManeuver(scenario, 'MANEUVER_A', 'A', 'desc', 18, { radial:0, alongTrack:0.85, crossTrack:0 }, 'LOW');
    const candB = simulateManeuver(scenario, 'MANEUVER_B', 'B', 'desc', 18, { radial:0, alongTrack:1.75, crossTrack:0 }, 'MODERATE');
    const candC = simulateManeuver(scenario, 'MANEUVER_C', 'C', 'desc', 18, { radial:0, alongTrack:0, crossTrack:3.60 }, 'HIGH');
    const candidates = [candA, candB, candC];

    expect(candidates).toHaveLength(3);
    expect(candidates[0].id).toBe('MANEUVER_A');
    expect(candidates[1].id).toBe('MANEUVER_B');
    expect(candidates[2].id).toBe('MANEUVER_C');

    expect(candidates[0].deltaV.total).toBe(0.85);
    expect(candidates[1].deltaV.total).toBe(1.75);
    expect(candidates[2].deltaV.total).toBe(3.60);
  });

  it('should re-propagate candidates and demonstrate real safety tradeoffs', () => {
    const scenario = generateSyntheticConjunctionScenario(baseState, 30);
    const candA = simulateManeuver(scenario, 'MANEUVER_A', 'A', 'desc', 18, { radial:0, alongTrack:0.85, crossTrack:0 }, 'LOW');
    const candB = simulateManeuver(scenario, 'MANEUVER_B', 'B', 'desc', 18, { radial:0, alongTrack:1.75, crossTrack:0 }, 'MODERATE');
    const candC = simulateManeuver(scenario, 'MANEUVER_C', 'C', 'desc', 18, { radial:0, alongTrack:0, crossTrack:3.60 }, 'HIGH');
    const candidates = [candA, candB, candC];

    // All candidates produce simulated ephemeris
    for (const c of candidates) {
      expect(c.trajectory.length).toBeGreaterThan(10);
      expect(c.fuelProxyKg).toBeGreaterThan(0);
    }

    // Candidate A (0.85 m/s): improved over 320m to ~670m, but still breaches 1.0 km threshold
    expect(candidates[0].postManeuverMissDistanceKm).toBeGreaterThan(0.5);
    expect(candidates[0].safetyPassed).toBe(false);

    // Candidate B (1.75 m/s): clears 1.0 km threshold safely
    expect(candidates[1].postManeuverMissDistanceKm).toBeGreaterThan(1.0);
    expect(candidates[1].safetyPassed).toBe(true);

    // Candidate C (3.60 m/s cross-track): clears threshold but requires highest fuel
    expect(candidates[2].postManeuverMissDistanceKm).toBeGreaterThan(1.0);
    expect(candidates[2].safetyPassed).toBe(true);
    expect(candidates[2].fuelProxyKg).toBeGreaterThan(candidates[1].fuelProxyKg);
  });
});
