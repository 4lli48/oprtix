import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './simulationEngine';

describe('Simulation Engine - Phase 9 State Machine Verification', () => {
  it('should run stages 1 through 13 in sequence and produce optimization results', async () => {
    const engine = new SimulationEngine();
    engine.pacingMs = 0; // Instant execution for unit tests

    await engine.startSimulation({ forceBaseline: true });
    const state = engine.getState();

    expect(state.currentStage).toBe('STAGE_13_SELECT_RECOMMENDED');
    expect(state.omm).not.toBeNull();
    expect(state.primaryTelemetry).not.toBeNull();
    expect(state.conjunction).not.toBeNull();
    expect(state.conjunction?.isConjunctionDetected).toBe(true);
    expect(state.candidates).toHaveLength(3);
    expect(state.optimization).not.toBeNull();
    expect(state.optimization?.recommendedId).toBe('MANEUVER_B');
    expect(state.aiExplanation).not.toBeNull();
    expect(state.logs.length).toBeGreaterThan(10);
  });

  it('should execute the maneuver (stages 14-17) and confirm mitigation', async () => {
    const engine = new SimulationEngine();
    engine.pacingMs = 0;

    await engine.startSimulation({ forceBaseline: true });
    engine.selectManeuver('MANEUVER_B');
    await engine.executeManeuver();

    const state = engine.getState();
    expect(state.currentStage).toBe('STAGE_17_VERIFY_SAFE');
    expect(state.isConjunctionMitigated).toBe(true);
    expect(state.postManeuverMissDistanceKm).toBeGreaterThan(1.0);
    expect(state.postManeuverRisk?.riskLevel).not.toBe('CRITICAL');
  });

  it('should execute Maneuver A and produce collision / unmitigated result', async () => {
    const engine = new SimulationEngine();
    engine.pacingMs = 0;

    await engine.startSimulation({ forceBaseline: true });
    engine.selectManeuver('MANEUVER_A');
    await engine.executeManeuver();

    const state = engine.getState();
    expect(state.currentStage).toBe('STAGE_17_VERIFY_SAFE');
    expect(state.isConjunctionMitigated).toBe(false);
    expect(state.postManeuverMissDistanceKm).toBeLessThan(1.0);
  });

  it('should execute Maneuver C and confirm mitigation with actual calculated tradeoffs', async () => {
    const engine = new SimulationEngine();
    engine.pacingMs = 0;

    await engine.startSimulation({ forceBaseline: true });
    engine.selectManeuver('MANEUVER_C');
    await engine.executeManeuver();

    const state = engine.getState();
    expect(state.currentStage).toBe('STAGE_17_VERIFY_SAFE');
    expect(state.isConjunctionMitigated).toBe(true);
    expect(state.postManeuverMissDistanceKm).toBeGreaterThan(1.0);
  });
});
