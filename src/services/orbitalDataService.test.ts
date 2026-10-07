import { describe, it, expect } from 'vitest';
import {
  validateOMMRecord,
  loadVerifiedBaseline,
  fetchOrbitalData,
  OrbitalDataValidationError,
} from './orbitalDataService';

describe('OrbitalDataService - Phase 1 Verification', () => {
  it('should validate a physically realistic OMM record', () => {
    const raw = {
      OBJECT_NAME: 'ISS (ZARYA)',
      OBJECT_ID: '1998-067A',
      EPOCH: '2026-10-06T12:44:07.877472',
      MEAN_MOTION: 15.4875,
      ECCENTRICITY: 0.00068,
      INCLINATION: 51.64,
      RA_OF_ASC_NODE: 109.07,
      ARG_OF_PERICENTER: 229.8,
      MEAN_ANOMALY: 130.24,
      NORAD_CAT_ID: 25544,
    };

    const validated = validateOMMRecord(raw);
    expect(validated.OBJECT_NAME).toBe('ISS (ZARYA)');
    expect(validated.NORAD_CAT_ID).toBe(25544);
    expect(validated.MEAN_MOTION).toBeCloseTo(15.4875);
    expect(validated.INCLINATION).toBeCloseTo(51.64);
  });

  it('should reject unphysical orbital parameters', () => {
    // Eccentricity >= 1 (hyperbolic / invalid for closed LEO orbit)
    expect(() =>
      validateOMMRecord({
        OBJECT_NAME: 'TEST',
        OBJECT_ID: 'TEST',
        EPOCH: '2026-10-06T00:00:00Z',
        NORAD_CAT_ID: 12345,
        MEAN_MOTION: 15.0,
        ECCENTRICITY: 1.2, // Invalid
        INCLINATION: 50,
        RA_OF_ASC_NODE: 0,
        ARG_OF_PERICENTER: 0,
        MEAN_ANOMALY: 0,
      })
    ).toThrow(OrbitalDataValidationError);

    // Negative mean motion
    expect(() =>
      validateOMMRecord({
        OBJECT_NAME: 'TEST',
        OBJECT_ID: 'TEST',
        EPOCH: '2026-10-06T00:00:00Z',
        NORAD_CAT_ID: 12345,
        MEAN_MOTION: -2.0, // Invalid
        ECCENTRICITY: 0.01,
        INCLINATION: 50,
        RA_OF_ASC_NODE: 0,
        ARG_OF_PERICENTER: 0,
        MEAN_ANOMALY: 0,
      })
    ).toThrow(OrbitalDataValidationError);
  });

  it('should load offline baseline with correct provenance', () => {
    const { omm, provenance } = loadVerifiedBaseline(25544, 'Testing baseline');
    expect(omm.NORAD_CAT_ID).toBe(25544);
    expect(omm.OBJECT_NAME).toContain('ISS');
    expect(provenance.source).toBe('BASELINE_DEMO');
    expect(provenance.isLive).toBe(false);
    expect(provenance.statusNote).toBe('Testing baseline');
  });

  it('should fall back to baseline when forceBaseline is set', async () => {
    const { omm, provenance } = await fetchOrbitalData({ forceBaseline: true });
    expect(omm.NORAD_CAT_ID).toBe(25544);
    expect(provenance.source).toBe('BASELINE_DEMO');
    expect(provenance.isLive).toBe(false);
  });

  it('should fetch live or gracefully fallback without crashing', async () => {
    const { omm, provenance } = await fetchOrbitalData({ timeoutMs: 4000 });
    expect(omm.NORAD_CAT_ID).toBe(25544);
    expect(omm.MEAN_MOTION).toBeGreaterThan(14);
    expect(['CELESTRAK_LIVE', 'BASELINE_DEMO']).toContain(provenance.source);
  });
});
