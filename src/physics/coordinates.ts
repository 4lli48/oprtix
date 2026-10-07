import type { CartesianVector3D, GeodeticCoordinates } from '../types/orbital';

// WGS-84 Earth Constants
export const EARTH_RADIUS_KM = 6378.137;
export const EARTH_MU = 398600.4418; // km^3 / s^2
export const EARTH_J2 = 1.08262668e-3;
export const EARTH_FLATTENING = 1.0 / 298.257223563;
export const EARTH_ROTATION_RATE_RAD_S = 7.292115e-5; // rad/s

export function norm(v: CartesianVector3D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalize(v: CartesianVector3D): CartesianVector3D {
  const n = norm(v);
  if (n === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

export function dot(a: CartesianVector3D, b: CartesianVector3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: CartesianVector3D, b: CartesianVector3D): CartesianVector3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function add(a: CartesianVector3D, b: CartesianVector3D): CartesianVector3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a: CartesianVector3D, b: CartesianVector3D): CartesianVector3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: CartesianVector3D, s: number): CartesianVector3D {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function distance(a: CartesianVector3D, b: CartesianVector3D): number {
  return norm(subtract(a, b));
}

/**
 * Calculates the local RTN (Radial, Transverse/Along-track, Normal/Cross-track)
 * unit vectors given an inertial position and velocity.
 */
export function computeRTNBasis(pos: CartesianVector3D, vel: CartesianVector3D): {
  radial: CartesianVector3D;
  alongTrack: CartesianVector3D;
  crossTrack: CartesianVector3D;
} {
  const alongTrack = normalize(vel); // Along-track (Transverse) direction T
  const h = cross(pos, vel);         // Angular momentum vector H
  const crossTrack = normalize(h);   // Orbit normal (Cross-track) N
  const radial = cross(alongTrack, crossTrack); // Radial unit vector R = T x N

  return { radial, alongTrack, crossTrack };
}

/**
 * Converts a Delta-V vector specified in local RTN coordinates (m/s)
 * into an inertial ECI vector (km/s).
 */
export function rtnToEciDeltaV(
  pos: CartesianVector3D,
  vel: CartesianVector3D,
  deltaV_RTN_m_s: { radial: number; alongTrack: number; crossTrack: number }
): CartesianVector3D {
  const basis = computeRTNBasis(pos, vel);

  // Convert m/s to km/s (divide by 1000)
  const dVr = deltaV_RTN_m_s.radial / 1000;
  const dVt = deltaV_RTN_m_s.alongTrack / 1000;
  const dVn = deltaV_RTN_m_s.crossTrack / 1000;

  return {
    x: basis.radial.x * dVr + basis.alongTrack.x * dVt + basis.crossTrack.x * dVn,
    y: basis.radial.y * dVr + basis.alongTrack.y * dVt + basis.crossTrack.y * dVn,
    z: basis.radial.z * dVr + basis.alongTrack.z * dVt + basis.crossTrack.z * dVn,
  };
}

/**
 * Converts ECI Cartesian position to Geodetic coordinates (Lat, Lon, Alt)
 * using Greenwich Mean Sidereal Time rotation approximation.
 */
export function eciToGeodetic(pos: CartesianVector3D, epoch: Date): GeodeticCoordinates {
  const r = norm(pos);
  const altitude = r - EARTH_RADIUS_KM;

  // Greenwich Sidereal Angle approximation (radians)
  const j2000 = new Date('2000-01-01T12:00:00Z').getTime();
  const dDays = (epoch.getTime() - j2000) / (86400 * 1000);
  const gmst = (18.697374558 + 24.06570982441908 * dDays) % 24;
  const gmstRad = (gmst * 15 * Math.PI) / 180;

  const xyDist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
  const latitudeRad = Math.atan2(pos.z, xyDist);
  let longitudeRad = Math.atan2(pos.y, pos.x) - gmstRad;

  // Normalize longitude to [-PI, +PI]
  longitudeRad = Math.atan2(Math.sin(longitudeRad), Math.cos(longitudeRad));

  return {
    latitude: (latitudeRad * 180) / Math.PI,
    longitude: (longitudeRad * 180) / Math.PI,
    altitude,
  };
}
