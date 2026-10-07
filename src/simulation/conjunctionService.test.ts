import { describe, it, expect } from 'vitest';
import {
  generateSyntheticConjunctionScenario,
  findClosestApproach,
  buildConjunctionSummary,
  computeRelativeState,
} from './conjunctionService';
import type { StateVector } from '../types/orbital';

describe('Conjunction Scenario Engine - Phase 3 Verification', () => {
  const baseState: StateVector = {
    position: { x: 3348.35, y: 2941.57, z: -5136.15 },
    velocity: { x: -3.39, y: 6.67, z: 1.60 },
    epoch: new Date('2026-10-06T12:00:00Z'),
  };

  it('should generate a deterministic synthetic close approach with ~320m miss distance', () => {
    const scenario = generateSyntheticConjunctionScenario(baseState, 30);

    expect(scenario.secondaryName).toBe('DEBRIS-2026-X49');
    expect(scenario.nominalMissDistanceMeters).toBeCloseTo(320, -1);

    const ca = findClosestApproach(scenario.primaryEphemeris, scenario.secondaryEphemeris);

    // Miss distance should be close to 320m
    expect(ca.missDistanceMeters).toBeGreaterThan(280);
    expect(ca.missDistanceMeters).toBeLessThan(360);

    // Encounter velocity should be close to 7.8 km/s
    expect(ca.relativeVelocityKmS).toBeGreaterThan(7.0);
    expect(ca.relativeVelocityKmS).toBeLessThan(8.5);
  });

  it('should build a CRITICAL risk conjunction summary breaching 1km threshold', () => {
    const scenario = generateSyntheticConjunctionScenario(baseState, 30);
    const summary = buildConjunctionSummary(scenario, baseState.epoch);

    expect(summary.isConjunctionDetected).toBe(true);
    expect(summary.riskScore).toBe('CRITICAL');
    expect(summary.missDistanceMeters).toBeLessThan(500);
    expect(summary.safetyThresholdMeters).toBe(1000);
    expect(summary.explanation).toContain('severely breaches');
  });

  it('should compute relative state accurately', () => {
    const primary: StateVector = {
      position: { x: 1000, y: 0, z: 0 },
      velocity: { x: 0, y: 7, z: 0 },
      epoch: new Date(),
    };
    const secondary: StateVector = {
      position: { x: 1000, y: 3, z: 4 },
      velocity: { x: 0, y: 7, z: 1 },
      epoch: new Date(),
    };

    const rel = computeRelativeState(primary, secondary);
    expect(rel.distanceKm).toBeCloseTo(5.0, 5); // sqrt(0 + 9 + 16)
    expect(rel.relativeVelocityKmS).toBeCloseTo(1.0, 5);
  });

  it('should guarantee deterministic scenario reproducibility', () => {
    const scn1 = generateSyntheticConjunctionScenario(baseState, 25);
    const scn2 = generateSyntheticConjunctionScenario(baseState, 25);

    expect(scn1.nominalMissDistanceMeters).toBe(scn2.nominalMissDistanceMeters);
    expect(scn1.primaryEphemeris.length).toBe(scn2.primaryEphemeris.length);
    expect(scn1.primaryEphemeris[10].position.x).toBe(scn2.primaryEphemeris[10].position.x);
    expect(scn1.secondaryEphemeris[10].position.y).toBe(scn2.secondaryEphemeris[10].position.y);
  });
});
