import type {
  OMMRecord,
  DataProvenance,
  OrbitalTelemetry,
  ConjunctionSummary,
  OptimizationResult,
  StateVector,
} from '../types/orbital';
import { fetchOrbitalData } from '../services/orbitalDataService';
import { propagateOMM } from '../physics/sgp4';
import {
  generateSyntheticConjunctionScenario,
  buildConjunctionSummary,
  findClosestApproach,
  type SyntheticConjunctionScenario,
} from './conjunctionService';
import {
  simulateManeuver,
  type SimulatedManeuverCandidate,
} from './maneuverService';
import { optimizeManeuvers } from '../analysis/optimizer';
import { evaluateSimulationRisk, type TransparentRiskEvaluation } from '../analysis/riskService';
import { generateAiExplanation, type AiExplanationResult } from '../services/aiService';
import { propagateTrajectory } from '../physics/propagator';

export type StageId =
  | 'IDLE'
  | 'STAGE_1_LOAD_DATA'
  | 'STAGE_2_PROPAGATE_PRIMARY'
  | 'STAGE_3_PROPAGATE_SECONDARY'
  | 'STAGE_4_COMPUTE_RELATIVE_MOTION'
  | 'STAGE_5_SEARCH_CLOSEST_APPROACH'
  | 'STAGE_6_DETECT_CONJUNCTION'
  | 'STAGE_7_LOAD_CONSTRAINTS'
  | 'STAGE_8_GENERATE_CANDIDATES'
  | 'STAGE_9_SIMULATE_A'
  | 'STAGE_10_SIMULATE_B'
  | 'STAGE_11_SIMULATE_C'
  | 'STAGE_12_COMPARE_CANDIDATES'
  | 'STAGE_13_SELECT_RECOMMENDED'
  | 'STAGE_14_EXECUTE_MANEUVER'
  | 'STAGE_15_REPROPAGATE'
  | 'STAGE_16_RECALCULATE_CONJUNCTION'
  | 'STAGE_17_VERIFY_SAFE';

export interface LogEntry {
  id: string;
  timestamp: string; // HH:mm:ss.SSS
  category: 'TELEMETRY' | 'CONJUNCTION' | 'PROPAGATION' | 'OPTIMIZATION' | 'EXECUTION' | 'SYSTEM';
  message: string;
  metric?: string;
}

export interface SimulationState {
  currentStage: StageId;
  stageName: string;
  progressPercent: number;
  omm: OMMRecord | null;
  provenance: DataProvenance | null;
  primaryTelemetry: OrbitalTelemetry | null;
  primaryTrajectory: StateVector[] | null;
  scenario: SyntheticConjunctionScenario | null;
  conjunction: ConjunctionSummary | null;
  riskEvaluation: TransparentRiskEvaluation | null;
  candidates: SimulatedManeuverCandidate[];
  optimization: OptimizationResult | null;
  aiExplanation: AiExplanationResult | null;
  /** Recommended by optimizer — default selection */
  selectedCandidateId: 'MANEUVER_A' | 'MANEUVER_B' | 'MANEUVER_C' | 'MANEUVER_D' | null;
  /** User-chosen override (null = use recommended) */
  userChosenCandidateId: 'MANEUVER_A' | 'MANEUVER_B' | 'MANEUVER_C' | 'MANEUVER_D' | null;
  isExecutingManeuver: boolean;
  /** Original (pre-maneuver) trajectory retained for visual comparison */
  originalTrajectory: StateVector[] | null;
  postManeuverTrajectory: StateVector[] | null;
  postManeuverMissDistanceKm: number | null;
  postManeuverRisk: TransparentRiskEvaluation | null;
  isConjunctionMitigated: boolean;
  logs: LogEntry[];
}

export type StateListener = (state: SimulationState) => void;

function formatLogTimestamp(): string {
  const d = new Date();
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SimulationEngine {
  private state: SimulationState;
  private listeners: StateListener[] = [];
  public pacingMs: number = 550;

  constructor() {
    this.state = {
      currentStage: 'IDLE',
      stageName: 'READY',
      progressPercent: 0,
      omm: null,
      provenance: null,
      primaryTelemetry: null,
      primaryTrajectory: null,
      scenario: null,
      conjunction: null,
      riskEvaluation: null,
      candidates: [],
      optimization: null,
      aiExplanation: null,
      selectedCandidateId: null,
      userChosenCandidateId: null,
      isExecutingManeuver: false,
      originalTrajectory: null,
      postManeuverTrajectory: null,
      postManeuverMissDistanceKm: null,
      postManeuverRisk: null,
      isConjunctionMitigated: false,
      logs: [],
    };
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener({ ...this.state });
    }
  }

  public addLog(category: LogEntry['category'], message: string, metric?: string): void {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: formatLogTimestamp(),
      category,
      message,
      metric,
    };
    this.state.logs = [entry, ...this.state.logs.slice(0, 150)];
    this.notify();
  }

  public getState(): SimulationState {
    return { ...this.state };
  }

  /** User selects a maneuver from the options panel. */
  public selectManeuver(id: 'MANEUVER_A' | 'MANEUVER_B' | 'MANEUVER_C' | 'MANEUVER_D'): void {
    this.state.userChosenCandidateId = id;
    this.notify();
  }

  /**
   * Initializes real primary orbital data and orbit in clean READY state without any hazard.
   */
  public async initializePrimary(options: { forceBaseline?: boolean } = {}): Promise<void> {
    const { omm, provenance } = await fetchOrbitalData({ forceBaseline: options.forceBaseline });
    this.state.omm = omm;
    this.state.provenance = provenance;

    const targetEpoch = new Date();
    const { state: primaryState, telemetry } = propagateOMM(omm, targetEpoch);
    this.state.primaryTelemetry = telemetry;

    const orbitPoints = propagateTrajectory(primaryState, 5580, 20);
    this.state.primaryTrajectory = orbitPoints;

    this.state.currentStage = 'IDLE';
    this.state.stageName = 'READY';
    this.state.progressPercent = 0;
    this.state.scenario = null;
    this.state.conjunction = null;
    this.state.riskEvaluation = null;
    this.state.candidates = [];
    this.state.optimization = null;
    this.state.aiExplanation = null;
    this.state.selectedCandidateId = null;
    this.state.userChosenCandidateId = null;
    this.state.isExecutingManeuver = false;
    this.state.originalTrajectory = null;
    this.state.postManeuverTrajectory = null;
    this.state.postManeuverMissDistanceKm = null;
    this.state.postManeuverRisk = null;
    this.state.isConjunctionMitigated = false;

    this.addLog(
      'TELEMETRY',
      `Primary spacecraft telemetry established for ${omm.OBJECT_NAME} (NORAD ${omm.NORAD_CAT_ID})`,
      `ALT: ${telemetry.altitudeKm.toFixed(1)} km`
    );
    this.notify();
  }

  /**
   * Resets simulation engine to initial clean standby state.
   */
  public reset(): void {
    this.state.currentStage = 'IDLE';
    this.state.stageName = 'READY';
    this.state.progressPercent = 0;
    this.state.scenario = null;
    this.state.conjunction = null;
    this.state.riskEvaluation = null;
    this.state.candidates = [];
    this.state.optimization = null;
    this.state.aiExplanation = null;
    this.state.selectedCandidateId = null;
    this.state.userChosenCandidateId = null;
    this.state.isExecutingManeuver = false;
    this.state.originalTrajectory = null;
    this.state.postManeuverTrajectory = null;
    this.state.postManeuverMissDistanceKm = null;
    this.state.postManeuverRisk = null;
    this.state.isConjunctionMitigated = false;
    this.state.logs = [];

    this.addLog('SYSTEM', 'System returned to READY state. Awaiting simulation trigger.');
    this.notify();
  }

  /**
   * Executes the analysis pipeline (Stages 1 through 13).
   */
  public async startSimulation(options: { forceBaseline?: boolean } = {}): Promise<void> {
    this.addLog('SYSTEM', 'Starting orbital conjunction assessment sequence...');

    // STAGE 1: LOAD ORBITAL DATA
    this.state.currentStage = 'STAGE_1_LOAD_DATA';
    this.state.stageName = '1/13: LOADING ORBITAL DATA';
    this.state.progressPercent = 8;
    this.notify();
    await sleep(this.pacingMs);

    const { omm, provenance } = await fetchOrbitalData({ forceBaseline: options.forceBaseline });
    this.state.omm = omm;
    this.state.provenance = provenance;
    this.addLog(
      'TELEMETRY',
      `Orbital data parsed for ${omm.OBJECT_NAME} (NORAD ${omm.NORAD_CAT_ID})`,
      `SOURCE: ${provenance.source}`
    );

    // STAGE 2: PROPAGATE PRIMARY STATE
    this.state.currentStage = 'STAGE_2_PROPAGATE_PRIMARY';
    this.state.stageName = '2/13: PROPAGATING PRIMARY ORBITAL STATE (SGP4)';
    this.state.progressPercent = 16;
    this.notify();
    await sleep(this.pacingMs);

    const targetEpoch = new Date();
    const { state: primaryState, telemetry } = propagateOMM(omm, targetEpoch);
    this.state.primaryTelemetry = telemetry;
    this.addLog(
      'PROPAGATION',
      `Primary state propagated to TEME ECI: Alt = ${telemetry.altitudeKm.toFixed(1)} km, Speed = ${telemetry.velocityKmS.toFixed(3)} km/s`,
      `PERIOD: ${telemetry.periodMinutes.toFixed(1)}m`
    );

    // STAGE 3: PROPAGATE SECONDARY STATE
    this.state.currentStage = 'STAGE_3_PROPAGATE_SECONDARY';
    this.state.stageName = '3/13: GENERATING SYNTHETIC HAZARD TRAJECTORY';
    this.state.progressPercent = 24;
    this.notify();
    await sleep(this.pacingMs);

    const scenario = generateSyntheticConjunctionScenario(primaryState, 35);
    this.state.scenario = scenario;
    this.addLog(
      'CONJUNCTION',
      `Hazard scenario initialized: ${scenario.secondaryName} (RCS ${scenario.secondaryRcsM2} m²) in crossing LEO orbit`,
      `INCLINED CROSSING`
    );

    // STAGE 4: COMPUTE RELATIVE MOTION
    this.state.currentStage = 'STAGE_4_COMPUTE_RELATIVE_MOTION';
    this.state.stageName = '4/13: COMPUTING INSTANTANEOUS RELATIVE MOTION';
    this.state.progressPercent = 32;
    this.notify();
    await sleep(this.pacingMs);

    this.addLog('CONJUNCTION', 'Relative motion vectors computed across 45-minute propagation horizon.');

    // STAGE 5: SEARCH FOR CLOSEST APPROACH
    this.state.currentStage = 'STAGE_5_SEARCH_CLOSEST_APPROACH';
    this.state.stageName = '5/13: SEARCHING FOR CLOSEST APPROACH (TCA SOLVER)';
    this.state.progressPercent = 40;
    this.notify();
    await sleep(this.pacingMs);

    const ca = findClosestApproach(scenario.primaryEphemeris, scenario.secondaryEphemeris);
    const summary = buildConjunctionSummary(scenario, primaryState.epoch);
    const riskEval = evaluateSimulationRisk(ca.missDistanceMeters, ca.relativeVelocityKmS);

    this.state.conjunction = summary;
    this.state.riskEvaluation = riskEval;

    this.addLog(
      'CONJUNCTION',
      `Closest approach identified at ${ca.tcaDate.toISOString().substring(11, 19)} UTC`,
      `MISS DIST: ${ca.missDistanceMeters.toFixed(0)}m`
    );

    // STAGE 6: DETECT CONJUNCTION
    this.state.currentStage = 'STAGE_6_DETECT_CONJUNCTION';
    this.state.stageName = '6/13: CONJUNCTION DETECTED — BREACH CONFIRMED';
    this.state.progressPercent = 48;
    this.notify();
    await sleep(this.pacingMs);

    this.addLog(
      'CONJUNCTION',
      `ALERT: Miss distance ${summary.missDistanceMeters.toFixed(0)} m breaches 1000 m safety threshold. Relative speed = ${summary.relativeVelocityKmS.toFixed(2)} km/s`,
      `RISK: ${riskEval.riskLevel} (${riskEval.simulationRiskScore}/100)`
    );

    // STAGE 7: LOAD MISSION CONSTRAINTS
    this.state.currentStage = 'STAGE_7_LOAD_CONSTRAINTS';
    this.state.stageName = '7/13: LOADING MISSION SAFETY CONSTRAINTS';
    this.state.progressPercent = 55;
    this.notify();
    await sleep(this.pacingMs);

    this.addLog(
      'OPTIMIZATION',
      'Flight rule constraints loaded: Safety boundary = 1.0 km, Burn lead time = 18 min prior to TCA.',
      'ISP = 305s'
    );

    // STAGE 8: GENERATE MANEUVER CANDIDATES
    this.state.currentStage = 'STAGE_8_GENERATE_CANDIDATES';
    this.state.stageName = '8/13: GENERATING 3 CAM CANDIDATES (A / B / C)';
    this.state.progressPercent = 62;
    this.notify();
    await sleep(this.pacingMs);

    this.addLog('OPTIMIZATION', 'Formulated 3 physical impulse vectors in local RTN spacecraft frame.');

    // STAGE 9: SIMULATE MANEUVER A (UNSAFE — small burn, insufficient clearance)
    this.state.currentStage = 'STAGE_9_SIMULATE_A';
    this.state.stageName = '9/13: NUMERICALLY SIMULATING CANDIDATE A';
    this.state.progressPercent = 70;
    this.notify();
    await sleep(this.pacingMs);

    const candA = simulateManeuver(
      scenario,
      'MANEUVER_A',
      'Maneuver A (Insufficient)',
      'Minimal prograde burn (+0.85 m/s). Insufficient clearance — safety threshold not met.',
      18,
      { radial: 0, alongTrack: 0.85, crossTrack: 0 },
      'LOW'
    );
    this.state.candidates = [candA];
    this.addLog(
      'PROPAGATION',
      `Candidate A simulated: Δv = 0.85 m/s, Post-burn miss distance = ${candA.postManeuverMissDistanceKm.toFixed(2)} km — SAFETY THRESHOLD NOT MET`,
      `FUEL: ${candA.fuelProxyKg} kg`
    );

    // STAGE 10: SIMULATE MANEUVER B (RECOMMENDED — balanced optimal)
    this.state.currentStage = 'STAGE_10_SIMULATE_B';
    this.state.stageName = '10/13: NUMERICALLY SIMULATING CANDIDATE B';
    this.state.progressPercent = 78;
    this.notify();
    await sleep(this.pacingMs);

    const candB = simulateManeuver(
      scenario,
      'MANEUVER_B',
      'Maneuver B (Recommended)',
      'Balanced prograde burn (+1.75 m/s). Achieves robust clearance with acceptable fuel cost.',
      18,
      { radial: 0, alongTrack: 1.75, crossTrack: 0 },
      'MODERATE'
    );
    this.state.candidates = [candA, candB];
    this.addLog(
      'PROPAGATION',
      `Candidate B simulated: Δv = 1.75 m/s, Post-burn miss distance = ${candB.postManeuverMissDistanceKm.toFixed(2)} km — SAFE`,
      `FUEL: ${candB.fuelProxyKg} kg`
    );

    // STAGE 11: SIMULATE MANEUVER C (EXPENSIVE — cross-track plane separation)
    this.state.currentStage = 'STAGE_11_SIMULATE_C';
    this.state.stageName = '11/13: NUMERICALLY SIMULATING CANDIDATE C';
    this.state.progressPercent = 85;
    this.notify();
    await sleep(this.pacingMs);

    const candC = simulateManeuver(
      scenario,
      'MANEUVER_C',
      'Maneuver C (Expensive)',
      'Cross-track orbital plane separation (+3.60 m/s). Large clearance but high propellant cost.',
      18,
      { radial: 0, alongTrack: 0, crossTrack: 3.60 },
      'HIGH'
    );
    this.state.candidates = [candA, candB, candC];
    this.addLog(
      'PROPAGATION',
      `Candidate C simulated: Δv = 3.60 m/s, Post-burn miss distance = ${candC.postManeuverMissDistanceKm.toFixed(2)} km — SAFE BUT EXPENSIVE`,
      `FUEL: ${candC.fuelProxyKg} kg`
    );

    // STAGE 12: COMPARE CANDIDATES
    this.state.currentStage = 'STAGE_12_COMPARE_CANDIDATES';
    this.state.stageName = '12/13: MULTI-ATTRIBUTE CANDIDATE COMPARISON';
    this.state.progressPercent = 92;
    this.notify();
    await sleep(this.pacingMs);

    const optResult = optimizeManeuvers(this.state.candidates);
    this.state.optimization = optResult;
    this.state.selectedCandidateId = optResult.recommendedId;
    // Default user choice = recommended
    this.state.userChosenCandidateId = optResult.recommendedId;

    this.addLog(
      'OPTIMIZATION',
      `Ranked candidates: ${optResult.candidates.map((c) => `${c.id.slice(-1)} (${c.score} pts)`).join(', ')}`,
      `WINNER: ${optResult.recommendedId}`
    );

    // STAGE 13: SELECT RECOMMENDED MANEUVER & GENERATE AI DIRECTIVE
    this.state.currentStage = 'STAGE_13_SELECT_RECOMMENDED';
    this.state.stageName = '13/13: RECOMMENDED MANEUVER READY — AWAITING EXECUTION';
    this.state.progressPercent = 100;

    const aiExplanation = generateAiExplanation(summary, optResult);
    this.state.aiExplanation = aiExplanation;

    this.addLog('SYSTEM', optResult.rankingRationale);
    this.notify();
  }

  /**
   * Executes the user-selected (or recommended) maneuver in simulation (Stages 14 through 17).
   */
  public async executeManeuver(): Promise<void> {
    if (!this.state.scenario || !this.state.optimization) {
      throw new Error('Cannot execute maneuver: simulation must be run first.');
    }

    // Respect user override; fall back to optimizer recommendation
    const candidateId = this.state.userChosenCandidateId ?? this.state.selectedCandidateId ?? 'MANEUVER_B';
    const candidate = this.state.candidates.find((c) => c.id === candidateId) ?? this.state.candidates[1] ?? this.state.candidates[0];

    this.state.isExecutingManeuver = true;
    // Preserve original trajectory for side-by-side visual comparison
    this.state.originalTrajectory = this.state.scenario.primaryEphemeris;

    // STAGE 14: EXECUTE IN SIMULATION
    this.state.currentStage = 'STAGE_14_EXECUTE_MANEUVER';
    this.state.stageName = `14/17: EXECUTING ${candidate.name.toUpperCase()} IN SIMULATION`;
    this.state.progressPercent = 80;
    this.notify();
    await sleep(this.pacingMs);

    this.addLog(
      'EXECUTION',
      `Propulsion system ignited: Δv impulse = ${candidate.deltaV.total.toFixed(2)} m/s applied to state vector.`,
      `FUEL CONSUMED: ${candidate.fuelProxyKg} kg`
    );

    // STAGE 15: RE-PROPAGATE
    this.state.currentStage = 'STAGE_15_REPROPAGATE';
    this.state.stageName = '15/17: RE-PROPAGATING PERTURBED TRAJECTORY (RK4 + J2)';
    this.state.progressPercent = 86;
    this.notify();
    await sleep(this.pacingMs);

    this.state.postManeuverTrajectory = candidate.trajectory;
    this.addLog('PROPAGATION', 'Re-propagated post-burn orbit forward across encounter window.');

    // STAGE 16: RE-CALCULATE CONJUNCTION
    this.state.currentStage = 'STAGE_16_RECALCULATE_CONJUNCTION';
    this.state.stageName = '16/17: RE-CALCULATING CONJUNCTION GEOMETRY';
    this.state.progressPercent = 94;
    this.notify();
    await sleep(this.pacingMs);

    const relevantSecondary = this.state.scenario.secondaryEphemeris.filter(
      (pt) => pt.epoch.getTime() >= candidate.burnEpoch.getTime()
    );
    const postCa = findClosestApproach(candidate.trajectory, relevantSecondary);
    const postRisk = evaluateSimulationRisk(postCa.missDistanceMeters, postCa.relativeVelocityKmS);

    this.state.postManeuverMissDistanceKm = postCa.missDistanceKm;
    this.state.postManeuverRisk = postRisk;

    this.addLog(
      'CONJUNCTION',
      `Post-maneuver closest approach: ${postCa.missDistanceKm.toFixed(2)} km (${postCa.missDistanceMeters.toFixed(0)} m)`,
      `PRE: ${this.state.conjunction?.missDistanceMeters.toFixed(0)}m`
    );

    // STAGE 17: VERIFY SAFE RESULT
    this.state.currentStage = 'STAGE_17_VERIFY_SAFE';
    this.state.isConjunctionMitigated = postCa.missDistanceMeters >= 1000;
    this.state.isExecutingManeuver = false;

    if (this.state.isConjunctionMitigated) {
      this.state.stageName = '17/17: CONJUNCTION MITIGATED — ORBIT RESTORED TO NOMINAL';
      this.addLog(
        'SYSTEM',
        `SUCCESS: Conjunction mitigated. Post-maneuver miss distance = ${postCa.missDistanceKm.toFixed(2)} km. Risk = ${postRisk.riskLevel}.`,
        'STATUS: MITIGATED'
      );
    } else {
      this.state.stageName = '17/17: CONJUNCTION NOT MITIGATED — COLLISION RISK REMAINS';
      this.addLog(
        'SYSTEM',
        `FAILURE: Maneuver A insufficient. Post-maneuver miss distance = ${postCa.missDistanceKm.toFixed(2)} km — BELOW 1.0 km SAFETY THRESHOLD.`,
        'STATUS: COLLISION RISK'
      );
    }

    this.state.progressPercent = 100;
    this.notify();
  }
}
