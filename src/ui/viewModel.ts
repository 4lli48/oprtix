import type { SimulationState, StageId } from '../simulation/simulationEngine';
import { evaluateSimulationRisk } from '../analysis/riskService';

/**
 * Pure presentation helpers. Nothing here computes orbital mechanics.
 */

export type Phase = 'ACQUIRING' | 'READY' | 'ANALYZING' | 'THREAT' | 'DECISION' | 'EXECUTING' | 'RESULT';
export type Tone = 'idle' | 'active' | 'danger' | 'action' | 'safe' | 'warn';
export type RiskLevel = 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NOMINAL';

export function stageNumber(id: StageId): number {
  return id === 'IDLE' ? 0 : parseInt(id.split('_')[1], 10);
}

export function getPhase(s: SimulationState): Phase {
  const n = stageNumber(s.currentStage);
  if (n === 0) return s.primaryTelemetry ? 'READY' : 'ACQUIRING';
  if (n <= 5) return 'ANALYZING';
  if (n <= 12) return 'THREAT';
  if (n === 13) return 'DECISION';
  if (n <= 16) return 'EXECUTING';
  return 'RESULT';
}

export function getStatus(s: SimulationState): { text: string; tone: Tone } {
  const n = stageNumber(s.currentStage);
  switch (n) {
    case 0:
      return s.primaryTelemetry ? { text: 'READY', tone: 'idle' } : { text: 'ACQUIRING ORBITAL DATA', tone: 'active' };
    case 1: return { text: 'LOADING ORBITAL DATA', tone: 'active' };
    case 2: return { text: 'PROPAGATING ORBIT', tone: 'active' };
    case 3: return { text: s.scenario ? 'SECONDARY OBJECT ADDED' : 'BUILDING SECONDARY OBJECT', tone: 'active' };
    case 4: return { text: 'ANALYZING RELATIVE MOTION', tone: 'active' };
    case 5: return { text: 'SEARCHING CLOSEST APPROACH', tone: 'active' };
    case 6:
    case 7:
      return s.conjunction?.isConjunctionDetected === false
        ? { text: 'NO CONJUNCTION', tone: 'idle' }
        : { text: 'CONJUNCTION DETECTED', tone: 'danger' };
    case 8: return { text: 'GENERATING MANEUVERS', tone: 'danger' };
    case 9: return { text: 'SIMULATING OPTION A', tone: 'danger' };
    case 10: return { text: 'SIMULATING OPTION B', tone: 'danger' };
    case 11: return { text: 'SIMULATING OPTION C', tone: 'danger' };
    case 12: return { text: 'COMPARING OPTIONS', tone: 'danger' };
    case 13: return { text: 'MANEUVER READY', tone: 'action' };
    case 14: return { text: 'EXECUTING MANEUVER', tone: 'active' };
    case 15: return { text: 'RE-PROPAGATING ORBIT', tone: 'active' };
    case 16: return { text: 'VERIFYING CONJUNCTION', tone: 'active' };
    default:
      if (s.isConjunctionMitigated) {
        return { text: 'CONJUNCTION MITIGATED', tone: 'safe' };
      }
      return { text: 'COLLISION DETECTED', tone: 'danger' };
  }
}

export function riskClass(level: RiskLevel | undefined): string {
  switch (level) {
    case 'CRITICAL':
    case 'HIGH': return 'c-danger';
    case 'ELEVATED': return 'c-warn';
    case 'NOMINAL': return 'c-safe';
    default: return '';
  }
}

export function fmtDistanceM(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

export function fmtUtc(d: Date | number): string {
  return new Date(d).toISOString().substring(11, 19);
}

export function stepLabel(s: SimulationState): string {
  return s.stageName.replace(/^\d+\/\d+:\s*/, '');
}

export interface OptionRow {
  id: 'MANEUVER_A' | 'MANEUVER_B' | 'MANEUVER_C' | 'MANEUVER_D';
  letter: string;
  name: string;
  deltaV: number;
  missMeters: number;
  impact: string;
  risk: RiskLevel;
  recommended: boolean;
  passes: boolean;
  fuelKg: number;
  tag: 'UNSAFE' | 'RECOMMENDED' | 'EXPENSIVE';
}

export function optionRows(s: SimulationState): OptionRow[] {
  const n = stageNumber(s.currentStage);
  const vrel = s.conjunction?.relativeVelocityKmS ?? 0;
  return s.candidates.map((c) => {
    const missMeters = c.postManeuverMissDistanceKm * 1000;
    const letter = c.id.slice(-1);
    const recommended = n >= 13 && s.optimization?.recommendedId === c.id;
    const passes = c.safetyPassed;
    let tag: 'UNSAFE' | 'RECOMMENDED' | 'EXPENSIVE';
    if (!passes) tag = 'UNSAFE';
    else if (recommended) tag = 'RECOMMENDED';
    else tag = 'EXPENSIVE';

    return {
      id: c.id,
      letter,
      name: c.name,
      deltaV: c.deltaV.total,
      missMeters,
      impact: c.missionImpact,
      risk: evaluateSimulationRisk(missMeters, vrel).riskLevel,
      recommended,
      passes,
      fuelKg: c.fuelProxyKg,
      tag,
    };
  });
}

export function recommendationReasons(s: SimulationState): string[] {
  const rows = optionRows(s);
  const rec = rows.find((r) => r.recommended);
  const thr = s.conjunction?.safetyThresholdMeters ?? 1000;
  if (!rec) return [];
  const out: string[] = [];
  if (rec.passes) {
    out.push(`Miss distance ${fmtDistanceM(rec.missMeters)} clears the ${fmtDistanceM(thr)} threshold`);
    out.push(`Safety margin +${fmtDistanceM(rec.missMeters - thr)}`);
  }
  const passing = rows.filter((r) => r.passes);
  if (passing.length > 0 && passing.every((r) => r.deltaV >= rec.deltaV)) {
    out.push(`Lowest Δv (${rec.deltaV.toFixed(2)} m/s) among options that pass safety`);
  } else {
    out.push(`Δv ${rec.deltaV.toFixed(2)} m/s`);
  }
  const worse = rows.filter((r) => r.id !== rec.id && r.passes && impactRank(r.impact) > impactRank(rec.impact));
  out.push(
    worse.length > 0
      ? `Mission impact ${rec.impact}, lower than Option ${worse.map((w) => w.letter).join(', ')}`
      : `Mission impact ${rec.impact}`
  );
  return out;
}

function impactRank(impact: string): number {
  return impact === 'LOW' ? 0 : impact === 'MODERATE' ? 1 : 2;
}

export function whySummary(s: SimulationState): string {
  const c = s.conjunction;
  if (!c) return '';
  return c.missDistanceMeters < c.safetyThresholdMeters
    ? `Projected miss distance (${fmtDistanceM(c.missDistanceMeters)}) is below the ${fmtDistanceM(c.safetyThresholdMeters)} simulation safety threshold.`
    : `Projected miss distance (${fmtDistanceM(c.missDistanceMeters)}) is above the ${fmtDistanceM(c.safetyThresholdMeters)} simulation safety threshold.`;
}
