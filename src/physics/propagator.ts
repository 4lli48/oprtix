import type { CartesianVector3D, StateVector } from '../types/orbital';
import {
  EARTH_MU,
  EARTH_RADIUS_KM,
  EARTH_J2,
  norm,
  add,
  scale,
} from './coordinates';

/**
 * Computes gravitational acceleration including central body gravity
 * and the dominant Earth oblateness (J2) harmonic perturbation.
 */
export function computeAcceleration(pos: CartesianVector3D): CartesianVector3D {
  const r2 = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
  const r = Math.sqrt(r2);
  const r3 = r2 * r;
  const r5 = r2 * r3;

  // Central two-body acceleration: -mu / r^3 * r
  const mu_over_r3 = EARTH_MU / r3;
  const ax_grav = -mu_over_r3 * pos.x;
  const ay_grav = -mu_over_r3 * pos.y;
  const az_grav = -mu_over_r3 * pos.z;

  // Earth J2 perturbation
  // a_J2 = -3/2 * J2 * mu * R_E^2 / r^5 * [...]
  const z2 = pos.z * pos.z;
  const factor = (1.5 * EARTH_J2 * EARTH_MU * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / r5;
  const zTerm = (5.0 * z2) / r2;

  const ax_j2 = -factor * pos.x * (1.0 - zTerm);
  const ay_j2 = -factor * pos.y * (1.0 - zTerm);
  const az_j2 = -factor * pos.z * (3.0 - zTerm);

  return {
    x: ax_grav + ax_j2,
    y: ay_grav + ay_j2,
    z: az_grav + az_j2,
  };
}

/**
 * Single Runge-Kutta 4th-order numerical integration step.
 * Takes state at t and computes state at t + dt.
 */
export function rk4Step(
  pos: CartesianVector3D,
  vel: CartesianVector3D,
  dt: number
): { pos: CartesianVector3D; vel: CartesianVector3D } {
  // k1 = f(y)
  const a1 = computeAcceleration(pos);
  const v1 = vel;

  // k2 = f(y + 0.5 * dt * k1)
  const pos2 = add(pos, scale(v1, 0.5 * dt));
  const vel2 = add(vel, scale(a1, 0.5 * dt));
  const a2 = computeAcceleration(pos2);

  // k3 = f(y + 0.5 * dt * k2)
  const pos3 = add(pos, scale(vel2, 0.5 * dt));
  const vel3 = add(vel, scale(a2, 0.5 * dt));
  const a3 = computeAcceleration(pos3);

  // k4 = f(y + dt * k3)
  const pos4 = add(pos, scale(vel3, dt));
  const vel4 = add(vel, scale(a3, dt));
  const a4 = computeAcceleration(pos4);

  // Combine: y_{n+1} = y_n + dt/6 * (k1 + 2*k2 + 2*k3 + k4)
  const dPos = scale(
    add(add(v1, scale(vel2, 2)), add(scale(vel3, 2), vel4)),
    dt / 6.0
  );
  const dVel = scale(
    add(add(a1, scale(a2, 2)), add(scale(a3, 2), a4)),
    dt / 6.0
  );

  return {
    pos: add(pos, dPos),
    vel: add(vel, dVel),
  };
}

/**
 * Propagates an initial state forward or backward in time by a total duration (seconds).
 * Returns ephemeris array of StateVector points.
 */
export function propagateTrajectory(
  initialState: StateVector,
  durationSeconds: number,
  stepSeconds: number = 5
): StateVector[] {
  const result: StateVector[] = [initialState];
  const totalSteps = Math.abs(Math.round(durationSeconds / stepSeconds));
  const dt = durationSeconds >= 0 ? stepSeconds : -stepSeconds;

  let currentPos = { ...initialState.position };
  let currentVel = { ...initialState.velocity };
  let currentEpochMs = initialState.epoch.getTime();

  for (let i = 0; i < totalSteps; i++) {
    const step = rk4Step(currentPos, currentVel, dt);
    currentPos = step.pos;
    currentVel = step.vel;
    currentEpochMs += dt * 1000;

    result.push({
      position: { ...currentPos },
      velocity: { ...currentVel },
      epoch: new Date(currentEpochMs),
    });
  }

  return result;
}

/**
 * Propagates a state directly to a specific target Date.
 */
export function propagateStateTo(
  initialState: StateVector,
  targetEpoch: Date,
  maxStepSeconds: number = 5
): StateVector {
  const dtTotal = (targetEpoch.getTime() - initialState.epoch.getTime()) / 1000;
  if (Math.abs(dtTotal) < 1e-4) {
    return {
      position: { ...initialState.position },
      velocity: { ...initialState.velocity },
      epoch: new Date(targetEpoch.getTime()),
    };
  }

  const steps = Math.ceil(Math.abs(dtTotal) / maxStepSeconds);
  const dt = dtTotal / steps;

  let currentPos = { ...initialState.position };
  let currentVel = { ...initialState.velocity };

  for (let i = 0; i < steps; i++) {
    const step = rk4Step(currentPos, currentVel, dt);
    currentPos = step.pos;
    currentVel = step.vel;
  }

  return {
    position: currentPos,
    velocity: currentVel,
    epoch: new Date(targetEpoch.getTime()),
  };
}

/**
 * Computes the specific orbital mechanical energy (km^2 / s^2).
 * epsilon = v^2 / 2 - mu / r
 */
export function computeSpecificOrbitalEnergy(pos: CartesianVector3D, vel: CartesianVector3D): number {
  const r = norm(pos);
  const v = norm(vel);
  return (v * v) / 2.0 - EARTH_MU / r;
}
