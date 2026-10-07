import * as satellite from 'satellite.js';
import type { OMMRecord, StateVector, OrbitalTelemetry } from '../types/orbital';
import { norm, eciToGeodetic, EARTH_MU } from './coordinates';

export interface Sgp4PropagationResult {
  state: StateVector;
  telemetry: OrbitalTelemetry;
}

/**
 * Propagates an OMM record to a given Date using SGP4/SDP4.
 */
export function propagateOMM(omm: OMMRecord, targetDate: Date): Sgp4PropagationResult {
  const satrec = satellite.json2satrec(omm as unknown as satellite.OMMJsonObjectV3);

  if (satrec.error !== 0) {
    throw new Error(`SGP4 initialization failed with error code: ${satrec.error}`);
  }

  const result = satellite.propagate(satrec, targetDate);

  if (!result || !result.position || !result.velocity) {
    throw new Error('SGP4 propagation returned null position or velocity vector.');
  }

  // satellite.js returns coordinates in km and km/s in TEME frame
  const posKm = result.position as satellite.EciVec3<number>;
  const velKmS = result.velocity as satellite.EciVec3<number>;

  const state: StateVector = {
    position: { x: posKm.x, y: posKm.y, z: posKm.z },
    velocity: { x: velKmS.x, y: velKmS.y, z: velKmS.z },
    epoch: targetDate,
  };

  const currentSpeed = norm(state.velocity);
  const geodetic = eciToGeodetic(state.position, targetDate);

  // Mean motion in radians per second
  const n_rad_s = (omm.MEAN_MOTION * 2 * Math.PI) / 86400;
  // Semi-major axis from mean motion
  const semiMajorAxisKm = Math.cbrt(EARTH_MU / (n_rad_s * n_rad_s));
  const periodMinutes = (2 * Math.PI * Math.sqrt(Math.pow(semiMajorAxisKm, 3) / EARTH_MU)) / 60;

  const telemetry: OrbitalTelemetry = {
    objectName: omm.OBJECT_NAME,
    noradCatId: omm.NORAD_CAT_ID,
    epoch: omm.EPOCH,
    altitudeKm: geodetic.altitude,
    velocityKmS: currentSpeed,
    periodMinutes,
    inclinationDeg: omm.INCLINATION,
    eccentricity: omm.ECCENTRICITY,
    geodetic,
    stateVector: state,
  };

  return { state, telemetry };
}
