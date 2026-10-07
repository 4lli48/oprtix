import type { OMMRecord, DataProvenance } from '../types/orbital';
import baselineOmmData from '../data/iss_omm_baseline.json';

const CELESTRAK_BASE_URL = 'https://celestrak.org/NORAD/elements/gp.php';
const DEFAULT_CAT_ID = 25544; // ISS (ZARYA)
const DEFAULT_TIMEOUT_MS = 6000;

export class OrbitalDataValidationError extends Error {
  constructor(message: string) {
    super(`[OrbitalDataValidationError] ${message}`);
    this.name = 'OrbitalDataValidationError';
  }
}

/**
 * Validates that an object strictly adheres to CCSDS OMM specification
 * and falls within physically viable orbital bounds for LEO satellites.
 */
export function validateOMMRecord(raw: unknown): OMMRecord {
  if (!raw || typeof raw !== 'object') {
    throw new OrbitalDataValidationError('OMM record must be a non-null object.');
  }

  const rec = raw as Record<string, unknown>;

  if (typeof rec.OBJECT_NAME !== 'string' || rec.OBJECT_NAME.trim().length === 0) {
    throw new OrbitalDataValidationError('Missing or invalid OBJECT_NAME.');
  }
  if (typeof rec.OBJECT_ID !== 'string' || rec.OBJECT_ID.trim().length === 0) {
    throw new OrbitalDataValidationError('Missing or invalid OBJECT_ID.');
  }
  if (typeof rec.EPOCH !== 'string' || isNaN(Date.parse(rec.EPOCH))) {
    throw new OrbitalDataValidationError(`Invalid ISO EPOCH: ${rec.EPOCH}`);
  }

  const noradId = Number(rec.NORAD_CAT_ID);
  if (!Number.isInteger(noradId) || noradId <= 0) {
    throw new OrbitalDataValidationError(`Invalid NORAD_CAT_ID: ${rec.NORAD_CAT_ID}`);
  }

  const meanMotion = Number(rec.MEAN_MOTION);
  if (isNaN(meanMotion) || meanMotion <= 0 || meanMotion > 30) {
    throw new OrbitalDataValidationError(`Mean motion out of physical bounds: ${rec.MEAN_MOTION} rev/day`);
  }

  const eccentricity = Number(rec.ECCENTRICITY);
  if (isNaN(eccentricity) || eccentricity < 0 || eccentricity >= 1) {
    throw new OrbitalDataValidationError(`Eccentricity must be in range [0, 1), got ${rec.ECCENTRICITY}`);
  }

  const inclination = Number(rec.INCLINATION);
  if (isNaN(inclination) || inclination < 0 || inclination > 180) {
    throw new OrbitalDataValidationError(`Inclination must be in range [0, 180] deg, got ${rec.INCLINATION}`);
  }

  const raan = Number(rec.RA_OF_ASC_NODE);
  if (isNaN(raan) || raan < 0 || raan > 360) {
    throw new OrbitalDataValidationError(`RAAN must be in range [0, 360] deg, got ${rec.RA_OF_ASC_NODE}`);
  }

  const argPericenter = Number(rec.ARG_OF_PERICENTER);
  if (isNaN(argPericenter) || argPericenter < 0 || argPericenter > 360) {
    throw new OrbitalDataValidationError(`Arg of Pericenter out of bounds [0, 360] deg, got ${rec.ARG_OF_PERICENTER}`);
  }

  const meanAnomaly = Number(rec.MEAN_ANOMALY);
  if (isNaN(meanAnomaly) || meanAnomaly < 0 || meanAnomaly > 360) {
    throw new OrbitalDataValidationError(`Mean Anomaly out of bounds [0, 360] deg, got ${rec.MEAN_ANOMALY}`);
  }

  const bstar = Number(rec.BSTAR ?? 0);
  const mmDot = Number(rec.MEAN_MOTION_DOT ?? 0);
  const mmDdot = Number(rec.MEAN_MOTION_DDOT ?? 0);

  return {
    OBJECT_NAME: rec.OBJECT_NAME,
    OBJECT_ID: rec.OBJECT_ID,
    EPOCH: rec.EPOCH,
    MEAN_MOTION: meanMotion,
    ECCENTRICITY: eccentricity,
    INCLINATION: inclination,
    RA_OF_ASC_NODE: raan,
    ARG_OF_PERICENTER: argPericenter,
    MEAN_ANOMALY: meanAnomaly,
    EPHEMERIS_TYPE: Number(rec.EPHEMERIS_TYPE ?? 0),
    CLASSIFICATION_TYPE: String(rec.CLASSIFICATION_TYPE ?? 'U'),
    NORAD_CAT_ID: noradId,
    ELEMENT_SET_NO: Number(rec.ELEMENT_SET_NO ?? 999),
    REV_AT_EPOCH: Number(rec.REV_AT_EPOCH ?? 0),
    BSTAR: bstar,
    MEAN_MOTION_DOT: mmDot,
    MEAN_MOTION_DDOT: mmDdot,
  };
}

export interface FetchOrbitalOptions {
  catId?: number;
  forceBaseline?: boolean;
  timeoutMs?: number;
}

export interface OrbitalDataResult {
  omm: OMMRecord;
  provenance: DataProvenance;
}

/**
 * Fetches orbital data from CelesTrak GP API or falls back to a verified offline baseline.
 * Provenance is transparently logged and surfaced to prevent deceptive UI states.
 */
export async function fetchOrbitalData(
  options: FetchOrbitalOptions = {}
): Promise<OrbitalDataResult> {
  const catId = options.catId ?? DEFAULT_CAT_ID;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (options.forceBaseline) {
    return loadVerifiedBaseline(catId, 'Forced Baseline Mode requested');
  }

  const url = `${CELESTRAK_BASE_URL}?CATNR=${catId}&FORMAT=JSON`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Received empty or non-array orbital payload from CelesTrak.');
    }

    const omm = validateOMMRecord(data[0]);
    const provenance: DataProvenance = {
      source: 'CELESTRAK_LIVE',
      endpoint: url,
      retrievedAt: new Date().toISOString(),
      noradCatId: omm.NORAD_CAT_ID,
      objectName: omm.OBJECT_NAME,
      epoch: omm.EPOCH,
      format: 'CCSDS_OMM_JSON',
      modelUsed: 'SGP4 / SDP4 General Perturbations',
      scenarioType: 'REAL_PRIMARY_SYNTHETIC_HAZARD',
      isLive: true,
      statusNote: 'Live telemetry stream synchronized with CelesTrak NORAD catalog.',
    };

    return { omm, provenance };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[orbitalDataService] Live fetch failed (${errorMessage}). Falling back to verified baseline.`);
    return loadVerifiedBaseline(
      catId,
      `Live CelesTrak connection unavailable (${errorMessage}). Switched to verified offline baseline.`
    );
  }
}

/**
 * Loads and validates local baseline OMM.
 */
export function loadVerifiedBaseline(catId: number, statusNote: string): OrbitalDataResult {
  const records = baselineOmmData as unknown[];
  const match = records.find(
    (r) => (r as Record<string, unknown>).NORAD_CAT_ID === catId
  ) ?? records[0];

  const omm = validateOMMRecord(match);
  const provenance: DataProvenance = {
    source: 'BASELINE_DEMO',
    retrievedAt: new Date().toISOString(),
    noradCatId: omm.NORAD_CAT_ID,
    objectName: omm.OBJECT_NAME,
    epoch: omm.EPOCH,
    format: 'CCSDS_OMM_JSON',
    modelUsed: 'SGP4 / SDP4 General Perturbations (Static Verification Set)',
    scenarioType: 'REAL_PRIMARY_SYNTHETIC_HAZARD',
    isLive: false,
    statusNote,
  };

  return { omm, provenance };
}
