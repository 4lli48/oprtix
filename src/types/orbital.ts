/**
 * Strict TypeScript types for Orbital Mechanics and Conjunction Assessment
 * Based on CCSDS OMM (Orbit Mean-Elements Message) & NASA CARA standards.
 */

export interface OMMRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number;       // revolutions per day
  ECCENTRICITY: number;      // dimensionless (0 <= e < 1 for elliptic)
  INCLINATION: number;       // degrees [0, 180]
  RA_OF_ASC_NODE: number;    // Right Ascension of Ascending Node (deg)
  ARG_OF_PERICENTER: number; // Argument of Pericenter (deg)
  MEAN_ANOMALY: number;      // Mean Anomaly at epoch (deg)
  EPHEMERIS_TYPE: number;
  CLASSIFICATION_TYPE: string;
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
  BSTAR: number;             // Drag term (1/EarthRadii)
  MEAN_MOTION_DOT: number;   // First time derivative of mean motion
  MEAN_MOTION_DDOT: number;  // Second time derivative of mean motion
}

export type ProvenanceSource = 'CELESTRAK_LIVE' | 'BASELINE_DEMO';

export interface DataProvenance {
  source: ProvenanceSource;
  endpoint?: string;
  retrievedAt: string;
  noradCatId: number;
  objectName: string;
  epoch: string;
  format: 'CCSDS_OMM_JSON';
  modelUsed: string;
  scenarioType: 'REAL_PRIMARY_SYNTHETIC_HAZARD';
  isLive: boolean;
  statusNote?: string;
}

export interface CartesianVector3D {
  x: number; // km
  y: number; // km
  z: number; // km
}

export interface StateVector {
  position: CartesianVector3D; // km in TEME/ECI
  velocity: CartesianVector3D; // km/s in TEME/ECI
  epoch: Date;
}

export interface GeodeticCoordinates {
  latitude: number;  // degrees [-90, +90]
  longitude: number; // degrees [-180, +180]
  altitude: number;  // kilometers above reference ellipsoid
}

export interface OrbitalTelemetry {
  objectName: string;
  noradCatId: number;
  epoch: string;
  altitudeKm: number;
  velocityKmS: number;
  periodMinutes: number;
  inclinationDeg: number;
  eccentricity: number;
  geodetic: GeodeticCoordinates;
  stateVector: StateVector;
}

export interface ConjunctionRelativeState {
  distanceKm: number;
  relativeVelocityKmS: number;
  relativePosition: CartesianVector3D;
  relativeVelocityVector: CartesianVector3D;
}

export interface ConjunctionSummary {
  primaryName: string;
  primaryNoradId: number;
  secondaryName: string;
  secondaryRcs: number; // m^2
  tcaDate: Date;
  secondsToTca: number;
  missDistanceMeters: number;
  relativeVelocityKmS: number;
  safetyThresholdMeters: number;
  riskScore: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NOMINAL';
  isConjunctionDetected: boolean;
  explanation: string;
}

export interface ManeuverCandidate {
  id: 'MANEUVER_A' | 'MANEUVER_B' | 'MANEUVER_C' | 'MANEUVER_D';
  name: string;
  description: string;
  burnEpoch: Date;
  deltaV: {
    radial: number;     // m/s
    alongTrack: number; // m/s (prograde/retrograde)
    crossTrack: number; // m/s (normal)
    total: number;      // m/s
  };
  deltaVVectorECI: CartesianVector3D; // km/s
  postManeuverMissDistanceKm: number;
  postManeuverTcaSeconds: number;
  fuelProxyKg: number;                // Calculated mass propellant proxy
  missionImpact: 'LOW' | 'MODERATE' | 'HIGH';
  safetyPassed: boolean;
  score: number;                      // Deterministic multi-objective score
  scoreBreakdown: {
    safetyMarginScore: number;
    deltaVEfficiencyScore: number;
    missionImpactScore: number;
  };
}

export interface OptimizationResult {
  recommendedId: 'MANEUVER_A' | 'MANEUVER_B' | 'MANEUVER_C' | 'MANEUVER_D';
  candidates: ManeuverCandidate[];
  rankingRationale: string;
  deterministicObjectiveWeights: {
    safetyWeight: number;
    deltaVWeight: number;
    impactWeight: number;
  };
}

export interface AnalysisState {
  provenance: DataProvenance;
  primaryTelemetry: OrbitalTelemetry;
  conjunction: ConjunctionSummary;
  candidates: ManeuverCandidate[];
  optimization: OptimizationResult | null;
  executedManeuver: ManeuverCandidate | null;
  postManeuverResult: {
    missDistanceMeters: number;
    riskScore: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NOMINAL';
    conjunctionMitigated: boolean;
  } | null;
  aiExplanation?: {
    narrative: string;
    tradeoffs: string;
    isFallback: boolean;
  };
}
