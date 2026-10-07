# ORBITX — Orbital Conjunction Assessment & Decision-Support System

> **Explainable Orbital Decision-Support Prototype**  
> Transforms orbital conjunction events into physically simulated maneuver candidates, evaluates safety-versus-cost tradeoffs deterministically, recommends optimal avoidance strategies, and verifies post-maneuver clearance through numerical orbital propagation.

---

## 1. Project Overview & Positioning

**ORBITX** is designed as an **explainable orbital decision-support system** for satellite conjunction assessment. In modern Low Earth Orbit (LEO) operations, satellite operators face thousands of close approach notifications weekly. ORBITX bridges the gap between raw orbital ephemerides and actionable flight decisions by providing transparent, deterministic evaluation of collision avoidance maneuvers (CAM).

### Core Pipeline
$$\text{DETECT} \longrightarrow \text{ANALYZE} \longrightarrow \text{SIMULATE} \longrightarrow \text{COMPARE} \longrightarrow \text{DECIDE} \longrightarrow \text{EXECUTE} \longrightarrow \text{VERIFY}$$

1. **DETECT**: Ingests real satellite orbital elements and identifies conjunction threats violating safety thresholds.
2. **ANALYZE**: Computes relative state vectors ($\mathbf{r}_{\text{rel}}, \mathbf{v}_{\text{rel}}$) and finds Time of Closest Approach (TCA) via quadratic search.
3. **SIMULATE**: Generates 3 candidate maneuvers (A, B, C) and propagates each trajectory using Runge-Kutta 4th-order (RK4) integration with Earth $J_2$ oblateness.
4. **COMPARE**: Evaluates candidate tradeoffs across $\Delta v$, post-maneuver miss distance, propellant consumption, and mission disruption.
5. **DECIDE**: Recommends the optimal candidate using a transparent, deterministic multi-objective scoring model.
6. **EXECUTE**: Applies the selected impulsive maneuver to the state vector at the planned burn epoch.
7. **VERIFY**: Re-propagates the perturbed orbit, recalculates closest approach, and visualizes verified clearance or collision consequences.

> **Operational Scope Disclaimer**: ORBITX is a prototype developed for technical demonstration and decision support. It is **not** operational flight software or certified safety-of-flight tooling.

---

## 2. Real vs. Simulated Data Separation

To maintain scientific integrity, ORBITX maintains a strict distinction between real retrieved data and simulated demonstration elements:

| Category | Real Elements | Simulated / Synthetic Elements |
| :--- | :--- | :--- |
| **Primary Satellite** | Real satellite identity (ISS / ZARYA, NORAD Cat ID: 25544), real retrieved orbital epoch, live or validated baseline orbital elements (CelesTrak GP). | Maneuver execution and re-propagation within the demonstration scenario. |
| **Secondary Object** | Real catalog object classification metadata (SATCAT / ESA DISCOS taxonomy: Debris, Rocket Body, Dead Satellite, Active Satellite). | Synthetic crossing trajectory and encounter geometry (controlled scenario with local minimum at TCA). |
| **Conjunction Threat** | Realistic LEO encounter velocities (~7.8 km/s) and standard aerospace geometry. | Controlled synthetic conjunction scenario (not a real-world active collision alert). |
| **Propulsion & Fuel** | Tsiolkovsky Rocket Equation formulation. | Spacecraft mass ($m_0 = 420,000\text{ kg}$) and thruster specific impulse ($I_{\text{sp}} = 305\text{ s}$) are defined engineering assumptions. |

---

## 3. Scientific Method & Implemented Equations

ORBITX only documents and presents equations that are **actually implemented** in the codebase.

### 3.1. Orbital Propagation (SGP4 + RK4 with $J_2$)
- **Initial Orbit**: SGP4 (Simplified General Perturbations 4) analytical model propagates General Perturbations (GP) mean elements from epoch to the simulation target window.
- **Maneuver Propagation**: Numerical integration of the perturbed two-body equations of motion using a Runge-Kutta 4th-order (RK4) scheme with Earth $J_2$ gravitational zonal harmonic:

$$\frac{d\mathbf{r}}{dt} = \mathbf{v}$$

$$\frac{d\mathbf{v}}{dt} = -\frac{\mu}{|\mathbf{r}|^3}\mathbf{r} + \mathbf{a}_{J_2}$$

Where:
- $\mu = 398600.4418\text{ km}^3/\text{s}^2$ (Earth gravitational parameter)
- $R_{\oplus} = 6378.137\text{ km}$ (Earth equatorial radius)
- $J_2 = 1.08263 \times 10^{-3}$ (Second zonal harmonic)
- The $J_2$ perturbation acceleration vector $\mathbf{a}_{J_2}$ in the Earth-Centered Inertial (ECI) frame:

$$a_{J_2, x} = -\frac{3}{2}\frac{J_2 \mu R_{\oplus}^2}{r^5} x \left(1 - \frac{5 z^2}{r^2}\right)$$

$$a_{J_2, y} = -\frac{3}{2}\frac{J_2 \mu R_{\oplus}^2}{r^5} y \left(1 - \frac{5 z^2}{r^2}\right)$$

$$a_{J_2, z} = -\frac{3}{2}\frac{J_2 \mu R_{\oplus}^2}{r^5} z \left(3 - \frac{5 z^2}{r^2}\right)$$

### 3.2. Relative Kinematics & Closest Approach (TCA)
For primary state vector $(\mathbf{r}_1, \mathbf{v}_1)$ and secondary state vector $(\mathbf{r}_2, \mathbf{v}_2)$:

$$\mathbf{r}_{\text{rel}} = \mathbf{r}_2 - \mathbf{r}_1, \quad \mathbf{v}_{\text{rel}} = \mathbf{v}_2 - \mathbf{v}_1, \quad d = |\mathbf{r}_{\text{rel}}|$$

Closest approach is computed by searching the discrete ephemeris for the local minimum distance, followed by a **sub-meter quadratic interpolation** around the discrete minimum index $i$:

$$t_{\text{refine}} = -\frac{d_{i+1}^2 - d_{i-1}^2}{2(d_{i+1}^2 - 2d_i^2 + d_{i-1}^2)} \cdot \Delta t$$

### 3.3. Impulsive Maneuver Formulation
Maneuvers are modeled as instantaneous velocity impulses applied at the burn epoch $t_{\text{burn}}$:

$$\mathbf{v}_{\text{post}}(t_{\text{burn}}) = \mathbf{v}_{\text{pre}}(t_{\text{burn}}) + \Delta\mathbf{v}_{\text{ECI}}$$

Where $\Delta\mathbf{v}$ is defined in the local Radial-Transverse-Normal (RTN) reference frame and transformed to ECI coordinates:
- $\mathbf{u}_R = \frac{\mathbf{r}}{|\mathbf{r}|}$ (Radial)
- $\mathbf{u}_N = \frac{\mathbf{r} \times \mathbf{v}}{|\mathbf{r} \times \mathbf{v}|}$ (Cross-Track / Orbit Normal)
- $\mathbf{u}_T = \mathbf{u}_N \times \mathbf{u}_R$ (Along-Track / In-Plane Tangent)

### 3.4. Propellant Consumption (Tsiolkovsky Model)
Estimated fuel consumption proxy uses the classical Tsiolkovsky Rocket Equation:

$$\Delta v = I_{\text{sp}} g_0 \ln\left(\frac{m_0}{m_f}\right) \implies \Delta m = m_0 \left(1 - \exp\left(-\frac{\Delta v}{I_{\text{sp}} g_0}\right)\right)$$

- $g_0 = 9.80665\text{ m/s}^2$
- $I_{\text{sp}} = 305\text{ s}$ (Hypergolic hydrazine/UDMH thruster engineering assumption)
- $m_0 = 420,000\text{ kg}$ (Spacecraft nominal mass proxy)

### 3.5. Deterministic Optimization Scoring Model
Maneuver candidates are ranked using an explicit, deterministic multi-attribute objective model:

$$\text{Decision Score} = w_{\text{safety}} \cdot S_{\text{safety}} + w_{\Delta v} \cdot S_{\Delta v} + w_{\text{impact}} \cdot S_{\text{impact}} - \text{Penalty}_{\text{unsafe}}$$

- **Safety Weight ($w = 0.50$)**: Evaluates post-maneuver clearance margin above the $1.0\text{ km}$ safety threshold.
- **$\Delta v$ Cost Weight ($w = 0.30$)**: Rewards propellant-efficient delta-V expenditures.
- **Mission Impact Weight ($w = 0.20$)**: Evaluates orbital period shift and downstream payload constraints.
- **Penalty (50 pts)**: Applied strictly to any maneuver that fails the safety threshold.

---

## 4. Maneuver Candidates Comparison

| Candidate | Designation | Delta-V ($\Delta v$) | Post-Miss Distance | Estimated Fuel | Mission Impact | Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Option A** | Insufficient Burn | $0.85\text{ m/s}$ (Along-track) | $0.67\text{ km}$ ($< 1.0\text{ km}$) | $119.3\text{ kg}$ | LOW | **COLLISION / UNSAFE**<br>Fails safety threshold; physical impact & shockwave freeze event in 3D. |
| **Option B** | Balanced (Recommended) | $1.75\text{ m/s}$ (Along-track) | $1.72\text{ km}$ ($> 1.0\text{ km}$) | $245.7\text{ kg}$ | MODERATE | **SAFE & OPTIMAL**<br>Clears threshold with minimal propellant expenditure; recommended candidate. |
| **Option C** | Cross-Track Plane Shift | $3.60\text{ m/s}$ (Cross-track) | $3.01\text{ km}$ ($> 1.0\text{ km}$) | $505.2\text{ kg}$ | HIGH | **SAFE · HIGH COST**<br>Large out-of-plane clearance; high propellant consumption tradeoff. |

---

## 5. Risk Assessment Terminology

In adherence to aerospace rigor:
- **ORBITX does not claim a covariance-based Probability of Collision ($P_c$)**. A true $P_c$ requires full operational state error covariance matrices ($\mathbf{C}_{\text{pri}}, \mathbf{C}_{\text{sec}}$) combined into encounter b-plane error ellipses via Foster-1992 or Akella-Alfriend algorithms.
- Instead, ORBITX reports a **Simulation Risk Score (0–100)** derived deterministically from:
  1. Miss distance relative to the $1.0\text{ km}$ safety perimeter.
  2. Relative encounter kinetic energy index ($E_{\text{rel}} \propto \frac{1}{2} v_{\text{rel}}^2$).

---

## 6. Authoritative Aerospace References

1. **NASA CARA (Conjunction Assessment Risk Analysis)**: Safety perimeter guidelines and operational conjunction workflows for uncrewed and human spaceflight missions.
2. **CCSDS Conjunction Data Message (CDM 508.0-B-1)**: The international standard for exchanging orbital conjunction assessment data between satellite operators and space surveillance networks.
3. **CCSDS Orbit Data Messages (ODM 502.0-B-2)**: Standard formats for orbital ephemerides (OMM, OPM, OEM).
4. **CelesTrak Current GP Data**: Authoritative source for current NORAD General Perturbations element sets and satellite catalog data.
5. **CelesTrak SATCAT**: Space object catalog identity, country of origin, radar cross-section (RCS), and operational status metadata.
6. **ESA DISCOS (Database and Information System Characterising Objects in Space)**: Authoritative historical catalog of space objects, physical properties, launch history, and fragmentation events.
7. **NASA Orbital Debris Program Office**: Global reference for orbital debris measurement, modeling, and mitigation guidelines.
8. **NASA ORDEM 3.2 (Orbital Debris Engineering Model)**: Baseline engineering flux model for characterizing background debris populations in Earth orbit.

---

## 7. Limitations & Prototype Boundaries

- **Impulsive Delta-V**: Maneuvers are modeled as impulsive burns ($\Delta t = 0$), rather than finite-duration continuous low-thrust burns.
- **Deterministic Risk**: Does not incorporate full Gaussian error covariance matrices or Monte Carlo non-linear dispersion.
- **Synthetic Geometry**: Conjunction scenarios are controlled geometric models designed to demonstrate verifiable decision tradeoffs.
- **Propellant Proxy**: Fuel calculations assume nominal dry/wet mass parameters rather than real-time telemetry from on-board propellant tanks.

---

## 8. Technology Stack & Installation

- **Core**: TypeScript, Three.js (WebGL 3D orbital visualization)
- **Physics**: SGP4 (satellite.js), Custom RK4 + $J_2$ numerical propagator, Coordinate transformations (ECI / RTN)
- **Tooling**: Vite, Vitest (23 unit tests)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/4lli48/oprtix.git
cd oprtix

# Install dependencies
npm install

# Run unit tests
npm test

# Start local development server
npm run dev
```

Build for production:
```bash
npm run build
```

---

## 9. License

MIT License. Developed as an explainable orbital conjunction assessment prototype.
