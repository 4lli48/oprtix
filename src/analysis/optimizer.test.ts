import { describe, it, expect } from 'vitest';
import { evaluateSimulationRisk } from './riskService';
import { optimizeManeuvers } from './optimizer';
import { simulateManeuver } from '../simulation/maneuverService';
import { generateSyntheticConjunctionScenario } from '../simulation/conjunctionService';
import type { StateVector } from '../types/orbital';

describe('Analysis & Optimization Layer - Phase 5 Verification', () => {
  const baseState: StateVector = {
    position: { x: 3348.35, y: 2941.57, z: -5136.15 },
    velocity: { x: -3.39, y: 6.67, z: 1.60 },
    epoch: new Date('2026-10-06T12:00:00Z'),
  };

  it('should categorize risk levels transparently according to miss distance', () => {
    const r1 = evaluateSimulationRisk(320, 7.8);
    expect(r1.riskLevel).toBe('CRITICAL');
    expect(r1.simulationRiskScore).toBeGreaterThan(80);
    expect(r1.isOperationalCertified).toBe(false);

    const r2 = evaluateSimulationRisk(750, 7.8);
    expect(r2.riskLevel).toBe('HIGH');
    expect(r2.simulationRiskScore).toBeGreaterThanOrEqual(60);

    const r3 = evaluateSimulationRisk(2200, 7.8);
    expect(r3.riskLevel).toBe('ELEVATED');

    const r4 = evaluateSimulationRisk(6000, 7.8);
    expect(r4.riskLevel).toBe('NOMINAL');
    expect(r4.simulationRiskScore).toBeLessThan(20);
  });

  it('should optimize and recommend Candidate B deterministically', () => {
    const scenario = generateSyntheticConjunctionScenario(baseState, 30);
    const candA = simulateManeuver(scenario, 'MANEUVER_A', 'A', 'desc', 18, { radial: 0, alongTrack: 0.85, crossTrack: 0 }, 'LOW');
    const candB = simulateManeuver(scenario, 'MANEUVER_B', 'B', 'desc', 18, { radial: 0, alongTrack: 1.75, crossTrack: 0 }, 'MODERATE');
    const candC = simulateManeuver(scenario, 'MANEUVER_C', 'C', 'desc', 18, { radial: 0, alongTrack: 0, crossTrack: 3.60 }, 'HIGH');
    const candidates = [candA, candB, candC];

    const result = optimizeManeuvers(candidates);

    expect(result.recommendedId).toBe('MANEUVER_B');
    expect(result.candidates[0].id).toBe('MANEUVER_B');
    expect(result.candidates[0].score).toBeGreaterThan(result.candidates[1].score);
    expect(result.candidates[0].score).toBeGreaterThan(result.candidates[2].score);
    expect(result.rankingRationale).toContain('Candidate B selected');
  });
});
