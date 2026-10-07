import { describe, it, expect } from 'vitest';
import {
  norm,
  dot,
  computeRTNBasis,
  rtnToEciDeltaV,
} from './coordinates';
import {
  propagateTrajectory,
  propagateStateTo,
  computeSpecificOrbitalEnergy,
} from './propagator';
import { propagateOMM } from './sgp4';
import { loadVerifiedBaseline } from '../services/orbitalDataService';
import type { StateVector } from '../types/orbital';

describe('Physics & Propagation Engine - Phase 2 Verification', () => {
  it('should construct an orthonormal RTN coordinate frame', () => {
    const pos = { x: 5000, y: 3000, z: -2500 };
    const vel = { x: -3.2, y: 6.5, z: 1.8 };

    const rtn = computeRTNBasis(pos, vel);

    expect(norm(rtn.radial)).toBeCloseTo(1.0, 6);
    expect(norm(rtn.alongTrack)).toBeCloseTo(1.0, 6);
    expect(norm(rtn.crossTrack)).toBeCloseTo(1.0, 6);

    expect(dot(rtn.radial, rtn.alongTrack)).toBeCloseTo(0.0, 6);
    expect(dot(rtn.alongTrack, rtn.crossTrack)).toBeCloseTo(0.0, 6);
    expect(dot(rtn.radial, rtn.crossTrack)).toBeCloseTo(0.0, 6);
  });

  it('should convert RTN delta-V to ECI inertial vector correctly', () => {
    const pos = { x: 6800, y: 0, z: 0 };
    const vel = { x: 0, y: 7.6, z: 0 };

    // 10 m/s prograde along-track
    const dV_ECI = rtnToEciDeltaV(pos, vel, { radial: 0, alongTrack: 10, crossTrack: 0 });

    // Along track is pure +Y direction in this test case
    expect(dV_ECI.x).toBeCloseTo(0, 5);
    expect(dV_ECI.y).toBeCloseTo(0.01, 5); // 10 m/s = 0.01 km/s
    expect(dV_ECI.z).toBeCloseTo(0, 5);
  });

  it('should propagate ISS from OMM using SGP4 with realistic altitude and speed', () => {
    const { omm } = loadVerifiedBaseline(25544, 'Test');
    const epoch = new Date(omm.EPOCH);

    const { state, telemetry } = propagateOMM(omm, epoch);

    expect(telemetry.altitudeKm).toBeGreaterThan(400);
    expect(telemetry.altitudeKm).toBeLessThan(440);
    expect(telemetry.velocityKmS).toBeGreaterThan(7.5);
    expect(telemetry.velocityKmS).toBeLessThan(7.8);
    expect(telemetry.periodMinutes).toBeGreaterThan(91);
    expect(telemetry.periodMinutes).toBeLessThan(94);
    expect(norm(state.position)).toBeCloseTo(6378.137 + telemetry.altitudeKm, 1);
  });

  it('should conserve orbital energy in RK4 + J2 integration over half an orbit', () => {
    const initialState: StateVector = {
      position: { x: 6790, y: 0, z: 0 },
      velocity: { x: 0, y: 7.66, z: 0 },
      epoch: new Date('2026-10-06T12:00:00Z'),
    };

    const initialEnergy = computeSpecificOrbitalEnergy(
      initialState.position,
      initialState.velocity
    );

    // Propagate for 45 minutes (2700 seconds)
    const trajectory = propagateTrajectory(initialState, 2700, 10);
    const finalPoint = trajectory[trajectory.length - 1];

    const finalEnergy = computeSpecificOrbitalEnergy(
      finalPoint.position,
      finalPoint.velocity
    );

    const relativeEnergyError = Math.abs((finalEnergy - initialEnergy) / initialEnergy);
    expect(relativeEnergyError).toBeLessThan(1e-4);
  });

  it('should maintain consistency between propagateTrajectory and propagateStateTo', () => {
    const initialState: StateVector = {
      position: { x: 4500, y: 4000, z: 2500 },
      velocity: { x: -4.5, y: 4.8, z: 3.2 },
      epoch: new Date('2026-10-06T12:00:00Z'),
    };

    const targetDate = new Date('2026-10-06T12:20:00Z'); // 1200 seconds later
    const stateDirect = propagateStateTo(initialState, targetDate, 5);
    const ephemeris = propagateTrajectory(initialState, 1200, 5);
    const stateFromTrajectory = ephemeris[ephemeris.length - 1];

    expect(stateDirect.position.x).toBeCloseTo(stateFromTrajectory.position.x, 3);
    expect(stateDirect.position.y).toBeCloseTo(stateFromTrajectory.position.y, 3);
    expect(stateDirect.position.z).toBeCloseTo(stateFromTrajectory.position.z, 3);
    expect(stateDirect.velocity.x).toBeCloseTo(stateFromTrajectory.velocity.x, 3);
  });
});
