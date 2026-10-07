import type { SimulationEngine, SimulationState } from '../simulation/simulationEngine';
import type { OrbitalScene, SceneView } from '../visualization/orbitalScene';
import { ALTITUDE_EXAGGERATION } from '../visualization/orbitalScene';
import {
  fmtDistanceM,
  fmtUtc,
  getPhase,
  getStatus,
  optionRows,
  recommendationReasons,
  riskClass,
  stageNumber,
  stepLabel,
  whySummary,
  type Phase,
  type OptionRow,
} from './viewModel';

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export class MissionControlUI {
  private engine: SimulationEngine;
  private scene: OrbitalScene;
  private html = new Map<HTMLElement, string>();
  private detailsOpen = new Set<string>();
  private logOpen = false;

  private keys: {
    traj: unknown;
    scenario: unknown;
    tca: unknown;
    maneuver: unknown;
    post: unknown;
    original: unknown;
  } = { traj: null, scenario: null, tca: null, maneuver: null, post: null, original: null };

  private el = {
    status:         document.getElementById('status') as HTMLElement,
    statusText:     document.getElementById('status-text') as HTMLElement,
    dataSource:     document.getElementById('data-source') as HTMLElement,
    clock:          document.getElementById('clock') as HTMLElement,
    hudObjectName:  document.getElementById('hud-object-name') as HTMLElement,
    panel:          document.getElementById('panel') as HTMLElement,
    bottom:         document.getElementById('bottom') as HTMLElement,
    legend:         document.getElementById('legend') as HTMLElement,
    toolbar:        document.getElementById('toolbar') as HTMLElement,
    encounter:      document.getElementById('btn-encounter') as HTMLButtonElement,
    stageTime:      document.getElementById('stage-time') as HTMLElement,
    stageTimeValue: document.getElementById('stage-time-value') as HTMLElement,
    logToggle:      document.getElementById('log-toggle') as HTMLButtonElement,
    logLatest:      document.getElementById('log-latest') as HTMLElement,
    logList:        document.getElementById('log-list') as HTMLElement,
    pacing:         document.getElementById('pacing') as HTMLSelectElement,
  };

  constructor(engine: SimulationEngine, scene: OrbitalScene) {
    this.engine = engine;
    this.scene = scene;

    this.scene.onTick = (ms) => {
      this.el.stageTime.classList.toggle('hidden', ms === null);
      if (ms !== null) this.el.stageTimeValue.textContent = fmtUtc(ms) + ' UTC';
    };

    this.bind();
    this.tickClock();
    window.setInterval(() => this.tickClock(), 1000);
    this.engine.subscribe((s) => this.render(s));
  }

  public showError(message: string): void {
    this.el.statusText.textContent = message;
    this.el.status.dataset.tone = 'danger';
  }

  private bind(): void {
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'start') {
        this.engine.startSimulation().catch((err) => this.showError(String(err)));
      } else if (action === 'execute') {
        this.setView('ENCOUNTER');
        this.engine.executeManeuver().catch((err) => this.showError(String(err)));
      } else if (action === 'reset') {
        this.reset();
      } else if (action === 'select-maneuver') {
        const btn = target.closest<HTMLElement>('[data-action]')!;
        const id = btn.dataset.maneuver as 'MANEUVER_A' | 'MANEUVER_B' | 'MANEUVER_C' | 'MANEUVER_D';
        if (id) this.engine.selectManeuver(id);
      }
    });

    this.el.panel.addEventListener(
      'toggle',
      (e) => {
        const d = e.target as HTMLDetailsElement;
        const id = d.dataset.id;
        if (!id) return;
        if (d.open) this.detailsOpen.add(id);
        else this.detailsOpen.delete(id);
      },
      true
    );

    this.el.toolbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
      if (!btn || btn.disabled) return;
      this.setView(btn.dataset.view as SceneView);
    });

    this.el.logToggle.addEventListener('click', () => {
      this.logOpen = !this.logOpen;
      this.el.logList.classList.toggle('hidden', !this.logOpen);
      this.el.logToggle.setAttribute('aria-expanded', String(this.logOpen));
      this.el.logToggle.textContent = (this.logOpen ? '▼' : '▶') + ' SYS LOG';
    });

    this.el.pacing.addEventListener('change', () => {
      this.engine.pacingMs = Number(this.el.pacing.value);
    });
  }

  private reset(): void {
    this.engine.reset();
    this.scene.clearOriginalTrajectory();
    this.setView('OVERVIEW');
  }

  private setView(view: SceneView): void {
    this.scene.setView(view);
    this.el.toolbar.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === view);
    });
  }

  private tickClock(): void {
    this.el.clock.textContent = fmtUtc(Date.now());
  }

  private set(el: HTMLElement, html: string): void {
    if (this.html.get(el) === html) return;
    this.html.set(el, html);
    el.innerHTML = html;
  }

  private render(state: SimulationState): void {
    const n = stageNumber(state.currentStage);
    const phase = getPhase(state);

    const status = getStatus(state);
    this.el.statusText.textContent = status.text;
    this.el.status.dataset.tone = status.tone;

    if (state.primaryTelemetry) {
      this.el.hudObjectName.textContent = state.primaryTelemetry.objectName;
    }

    this.renderSource(state);
    this.set(this.el.panel, this.panelHtml(state, phase, n));
    this.set(this.el.bottom, this.bottomHtml(state, phase));
    const bottomVisible = this.el.bottom.innerHTML !== '';
    this.el.bottom.classList.toggle('hidden', !bottomVisible);
    this.el.legend.classList.toggle('bottom-open', bottomVisible);
    this.set(this.el.legend, this.legendHtml(state, n));
    this.el.encounter.disabled = !(n >= 6 && state.scenario);
    this.renderLog(state);
    this.syncScene(state, n);
  }

  private renderSource(state: SimulationState): void {
    const p = state.provenance;
    if (!p) {
      this.el.dataSource.textContent = 'ACQUIRING';
      this.el.dataSource.className = 'hud-meta-value';
      return;
    }
    if (p.isLive) {
      this.el.dataSource.textContent = 'CELESTRAK GP · LIVE';
      this.el.dataSource.className = 'hud-meta-value live-indicator';
    } else {
      this.el.dataSource.textContent = 'DEMO DATA';
      this.el.dataSource.className = 'hud-meta-value demo-indicator';
    }
  }

  private renderLog(state: SimulationState): void {
    const latest = state.logs[0];
    this.el.logLatest.textContent = latest ? `${latest.timestamp}  ${latest.message}` : '—';
    if (!this.logOpen) return;
    this.set(
      this.el.logList,
      state.logs.map((l) => `<li><time>${l.timestamp}</time><span>${esc(l.message)}</span></li>`).join('')
    );
  }

  private syncScene(state: SimulationState, n: number): void {
    const k = this.keys;

    if (state.primaryTrajectory && state.primaryTelemetry && k.traj !== state.primaryTrajectory) {
      k.traj = state.primaryTrajectory;
      this.scene.setPrimary(state.primaryTrajectory, state.primaryTelemetry.stateVector, {
        title: state.primaryTelemetry.objectName.split(' ')[0],
        subtitle: 'PRIMARY SATELLITE',
      });
    }

    if (state.scenario !== k.scenario) {
      k.scenario = state.scenario;
      if (state.scenario) {
        this.scene.showHazard(state.scenario.secondaryEphemeris, {
          title: state.scenario.secondaryName,
          subtitle: 'SECONDARY OBJECT',
        });
        this.scene.setPlayback(state.scenario.primaryEphemeris, state.scenario.secondaryEphemeris);
      } else {
        this.scene.clearHazard();
        k.tca = null;
        k.maneuver = null;
        k.post = null;
        k.original = null;
      }
    }

    const wantTca = n >= 6 && state.scenario && state.conjunction ? state.conjunction : null;
    if (wantTca !== k.tca) {
      k.tca = wantTca;
      const point = wantTca
        ? state.scenario!.primaryEphemeris.find((p) => p.epoch.getTime() === wantTca.tcaDate.getTime())
        : undefined;
      this.scene.setClosestApproach(point ? point.position : null, wantTca ? wantTca.tcaDate.getTime() : null);
    }

    const chosenId = state.userChosenCandidateId ?? state.selectedCandidateId;
    const chosen = n >= 13 && chosenId ? state.candidates.find((c) => c.id === chosenId) ?? null : null;
    if (chosen !== k.maneuver) {
      k.maneuver = chosen;
      this.scene.setManeuverPoint(chosen ? chosen.trajectory[0].position : null);
    }

    // Original trajectory ghost (shown during/after execution for comparison)
    if (state.originalTrajectory !== k.original) {
      k.original = state.originalTrajectory;
      this.scene.setOriginalTrajectory(state.originalTrajectory);
    }

    const postChanged = state.postManeuverTrajectory !== k.post || state.isConjunctionMitigated !== (k as any).mitigated || n >= 17 !== (k as any).verified;
    if (postChanged) {
      k.post = state.postManeuverTrajectory;
      (k as any).mitigated = state.isConjunctionMitigated;
      (k as any).verified = n >= 17;
      // Only verify outcome once Stage 17 is reached
      const isVerified = n >= 17;
      const mitigated = isVerified ? state.isConjunctionMitigated : true;
      this.scene.setPostManeuver(state.postManeuverTrajectory, mitigated, state.originalTrajectory);
      if (state.postManeuverTrajectory && state.scenario && chosen) {
        const burnMs = chosen.burnEpoch.getTime();
        const burnIdx = state.scenario.primaryEphemeris.findIndex((p) => p.epoch.getTime() >= burnMs);
        const startIdx = Math.max(0, burnIdx - 10);
        const visPost = this.scene.getVisualPostTrajectory() ?? state.postManeuverTrajectory;
        const combined = [
          ...state.scenario.primaryEphemeris.slice(startIdx, Math.max(burnIdx, 0)),
          ...visPost,
        ];
        const secondarySlice = state.scenario.secondaryEphemeris.slice(startIdx);
        this.scene.setPlayback(combined, secondarySlice);
      }
    }
  }

  private legendHtml(state: SimulationState, n: number): string {
    if (!state.primaryTelemetry) return '';
    const name = esc(state.primaryTelemetry.objectName.split(' ')[0]);
    const items: string[] = [
      `<div class="legend-item"><span class="sw sw-line" style="background:#4a9eca"></span>${name} orbit</div>`,
    ];
    if (state.scenario) {
      items.push(`<div class="legend-item"><span class="sw sw-line" style="background:#c07040"></span>Secondary object path</div>`);
    }
    if (n >= 6 && state.conjunction) {
      items.push(`<div class="legend-item"><span class="sw sw-ring" style="color:#c0464a"></span>Closest approach</div>`);
    }
    if (n >= 13) {
      items.push(`<div class="legend-item"><span class="sw sw-diamond" style="color:#bbc4cf"></span>Maneuver point</div>`);
    }
    if (state.originalTrajectory) {
      items.push(`<div class="legend-item"><span class="sw sw-line" style="background:#4a9eca;opacity:0.35"></span>Original path (pre-burn)</div>`);
    }
    if (state.postManeuverTrajectory) {
      const col = state.isConjunctionMitigated ? '#2fa878' : '#c0464a';
      const label = state.isConjunctionMitigated ? 'Post-maneuver path (safe)' : 'Post-maneuver path (collision risk)';
      items.push(`<div class="legend-item"><span class="sw sw-line" style="background:${col}"></span>${label}</div>`);
    }
    items.push(`<div class="legend-note">Altitude exaggerated ×${ALTITUDE_EXAGGERATION} for readability</div>`);
    return items.join('');
  }

  /* ------------------------------------------------------------------- panel */

  private panelHtml(state: SimulationState, phase: Phase, n: number): string {
    switch (phase) {
      case 'ACQUIRING':
        return `<div class="p-section">
          <div class="eyebrow active">System</div>
          <p class="why" style="margin-top:8px">Fetching current orbital elements from CelesTrak…</p>
        </div>`;

      case 'READY':
        return `${this.satelliteSection(state)}
          <div class="p-section">
            <button class="btn primary" data-action="start">START SIMULATION</button>
          </div>
          ${this.detailsSection(state)}`;

      case 'ANALYZING':
        return `${this.satelliteSection(state)}
          <div class="p-section">
            <div class="progress-wrap">
              <div class="step-count">STEP ${n} / 13</div>
              <div class="step-text">${esc(stepLabel(state))}</div>
              <div class="progress" style="margin-top:10px"><div style="width:${state.progressPercent}%"></div></div>
            </div>
          </div>
          ${this.detailsSection(state)}`;

      case 'THREAT':
        return `${this.conjunctionSection(state)}${this.detailsSection(state)}`;

      case 'DECISION':
        return this.decisionPanel(state);

      case 'EXECUTING': {
        const chosenId = state.userChosenCandidateId ?? state.selectedCandidateId;
        const steps = [
          [14, 'Applying Δv to the state vector'],
          [15, 'Re-propagating the orbit'],
          [16, 'Re-checking the conjunction'],
        ] as const;
        const li = steps
          .map(([stage, text]) => `<li class="${n > stage ? 'done' : n === stage ? 'now' : ''}">${text}</li>`)
          .join('');
        return `<div class="p-section">
            <div class="eyebrow warn">Executing ${chosenId ? `Maneuver ${chosenId.slice(-1)}` : 'maneuver'}</div>
            <ul class="steps" style="margin-top:12px">${li}</ul>
          </div>
          <div class="p-section">${this.threatLine(state)}</div>
          ${this.detailsSection(state)}`;
      }

      case 'RESULT':
        return this.resultPanel(state);
    }
  }

  private decisionPanel(state: SimulationState): string {
    const rows = optionRows(state);
    const chosenId = state.userChosenCandidateId ?? state.selectedCandidateId;
    const chosenRow = rows.find(r => r.id === chosenId);

    const cards = rows.map(r => this.maneuverCard(r, chosenId)).join('');

    const canExecute = !!chosenId;
    const btnLabel = chosenRow ? `EXECUTE MANEUVER ${chosenRow.letter}` : 'EXECUTE MANEUVER';
    const btnClass = chosenRow?.passes ? 'btn go' : 'btn danger-btn';

    // Show the recommendation reasons for whichever is selected
    let chosenDetail = '';
    if (chosenRow) {
      if (!chosenRow.passes) {
        chosenDetail = `<div class="p-section outcome-preview unsafe">
          <div class="eyebrow danger">⚠ PREDICTED OUTCOME</div>
          <div class="outcome-label c-danger" style="margin-top:6px">COLLISION RISK</div>
          <div class="why" style="margin-top:6px">Miss distance ${fmtDistanceM(chosenRow.missMeters)} falls below the 1.0 km safety threshold. Executing this maneuver will not prevent the conjunction.</div>
        </div>`;
      } else if (chosenRow.tag === 'RECOMMENDED') {
        const reasons = recommendationReasons(state).map(r => `<li>${esc(r)}</li>`).join('');
        chosenDetail = `<div class="p-section outcome-preview safe">
          <div class="eyebrow safe">✓ PREDICTED OUTCOME</div>
          <div class="outcome-label c-safe" style="margin-top:6px">SAFE CLEARANCE</div>
          <ul class="reasons" style="margin-top:8px">${reasons}</ul>
        </div>`;
      } else {
        // Expensive (D)
        chosenDetail = `<div class="p-section outcome-preview expensive">
          <div class="eyebrow warn">PREDICTED OUTCOME</div>
          <div class="outcome-label c-amber" style="margin-top:6px">SAFE — HIGH COST</div>
          <div class="why" style="margin-top:6px">Miss distance ${fmtDistanceM(chosenRow.missMeters)} — safe, but Δv = ${chosenRow.deltaV.toFixed(2)} m/s consumes ${chosenRow.fuelKg} kg propellant (${chosenRow.impact} mission impact).</div>
        </div>`;
      }
    }

    return `<div class="p-section">
        <div class="eyebrow">Select maneuver</div>
        <div class="maneuver-cards">${cards}</div>
      </div>
      ${chosenDetail}
      <div class="p-section">
        <button class="${btnClass}" data-action="execute" ${canExecute ? '' : 'disabled'}>${btnLabel}</button>
        <div style="margin-top:10px">${this.threatLine(state)}</div>
      </div>
      ${this.detailsSection(state)}`;
  }

  private maneuverCard(r: OptionRow, chosenId: string | null | undefined): string {
    const selected = r.id === chosenId;
    let tagHtml = '';
    let cardClass = 'mcard';
    if (r.tag === 'UNSAFE') { tagHtml = `<span class="mcard-tag unsafe">UNSAFE</span>`; cardClass += ' mcard-unsafe'; }
    else if (r.tag === 'RECOMMENDED') { tagHtml = `<span class="mcard-tag rec">RECOMMENDED</span>`; cardClass += ' mcard-rec'; }
    else { tagHtml = `<span class="mcard-tag exp">EXPENSIVE</span>`; cardClass += ' mcard-exp'; }
    if (selected) cardClass += ' mcard-selected';

    return `<button class="${cardClass}" data-action="select-maneuver" data-maneuver="${r.id}">
      <div class="mcard-head">
        <span class="mcard-letter">${r.letter}</span>
        ${tagHtml}
        ${selected ? '<span class="mcard-sel-dot"></span>' : ''}
      </div>
      <div class="mcard-stats">
        <div class="mcard-stat"><span>Δv</span><strong>${r.deltaV.toFixed(2)} m/s</strong></div>
        <div class="mcard-stat"><span>Miss</span><strong class="${riskClass(r.risk)}">${fmtDistanceM(r.missMeters)}</strong></div>
        <div class="mcard-stat"><span>Fuel</span><strong>${r.fuelKg} kg</strong></div>
      </div>
    </button>`;
  }

  private resultPanel(state: SimulationState): string {
    const chosen = state.candidates.find((c) => c.id === (state.userChosenCandidateId ?? state.selectedCandidateId));
    const ok = state.isConjunctionMitigated;
    const chosenLetter = chosen?.id.slice(-1) ?? '?';
    const pr = state.postManeuverRisk;
    const afterM = (state.postManeuverMissDistanceKm ?? 0) * 1000;

    let outcomeBlock = '';
    if (!ok) {
      // A — collision
      outcomeBlock = `<div class="p-section outcome-block outcome-collision">
        <div class="eyebrow danger">Execution Result — Maneuver ${chosenLetter}</div>
        <div class="outcome-big c-danger" style="margin-top:8px">COLLISION DETECTED</div>
        <div class="outcome-sub c-danger">HIGH RISK · MISSION FAILED</div>
        <div class="why" style="margin-top:10px">Miss distance ${fmtDistanceM(afterM)} remains below the 1.0 km safety threshold. Conjunction was not prevented.</div>
      </div>`;
    } else if (chosen?.missionImpact === 'HIGH') {
      // D — expensive but safe
      outcomeBlock = `<div class="p-section outcome-block outcome-expensive">
        <div class="eyebrow warn">Execution Result — Maneuver ${chosenLetter}</div>
        <div class="outcome-big c-safe" style="margin-top:8px">CONJUNCTION MITIGATED</div>
        <div class="outcome-sub c-amber">HIGH COST · MISSION CONTINUES</div>
        <div class="why" style="margin-top:10px">Safe clearance achieved at ${fmtDistanceM(afterM)}. Δv = ${chosen.deltaV.total.toFixed(2)} m/s consumed ${chosen.fuelProxyKg} kg propellant — higher than optimal.</div>
      </div>`;
    } else {
      // B — recommended
      outcomeBlock = `<div class="p-section outcome-block outcome-safe">
        <div class="eyebrow safe">Execution Result — Maneuver ${chosenLetter}</div>
        <div class="outcome-big c-safe" style="margin-top:8px">CONJUNCTION MITIGATED</div>
        <div class="outcome-sub c-safe">MISSION SAFE</div>
      </div>
      <div class="p-section outcome-preview safe" style="margin-top:0">
        <div class="eyebrow safe">AI RECOMMENDATION · MANEUVER B</div>
        <dl class="kv" style="margin-top:8px">
          <div><dt>Risk</dt><dd class="c-safe">LOW</dd></div>
          <div><dt>Fuel</dt><dd>8% <small>(${chosen ? chosen.fuelProxyKg : '—'} kg)</small></dd></div>
          <div><dt>Mission impact</dt><dd class="c-safe">LOW</dd></div>
        </dl>
      </div>`;
    }

    return `${outcomeBlock}
      <div class="p-section">
        <dl class="kv">
          <div><dt>Post-maneuver miss dist.</dt><dd class="${ok ? 'c-safe' : 'c-danger'}">${fmtDistanceM(afterM)}</dd></div>
          <div><dt>Risk level</dt><dd class="${riskClass(pr?.riskLevel)}">${pr?.riskLevel ?? '—'}</dd></div>
          <div><dt>Δv used</dt><dd>${chosen ? chosen.deltaV.total.toFixed(2) : '—'}<small>m/s</small></dd></div>
          <div><dt>Propellant used</dt><dd>${chosen ? chosen.fuelProxyKg : '—'}<small>kg</small></dd></div>
          <div><dt>Mission impact</dt><dd>${chosen ? chosen.missionImpact : '—'}</dd></div>
        </dl>
      </div>
      <div class="p-section">
        <button class="btn ghost" data-action="reset">NEW SIMULATION RUN</button>
      </div>
      ${this.detailsSection(state)}`;
  }

  private satelliteSection(state: SimulationState): string {
    const t = state.primaryTelemetry!;
    const live = state.provenance?.isLive;
    return `<div class="p-section">
        <div class="eyebrow">Primary satellite</div>
        <h2 class="obj-name">${esc(t.objectName)}</h2>
        <div class="obj-meta">NORAD ${t.noradCatId}${state.omm ? ` · ${esc(state.omm.OBJECT_ID)}` : ''}</div>
      </div>
      <div class="p-section">
        <dl class="kv">
          <div><dt>Altitude</dt><dd>${t.altitudeKm.toFixed(1)}<small>km</small></dd></div>
          <div><dt>Velocity</dt><dd>${t.velocityKmS.toFixed(2)}<small>km/s</small></dd></div>
          <div><dt>Orbital period</dt><dd>${t.periodMinutes.toFixed(1)}<small>min</small></dd></div>
          <div><dt>Inclination</dt><dd>${t.inclinationDeg.toFixed(1)}<small>°</small></dd></div>
          <div><dt>Orbital data</dt><dd class="${live ? 'c-blue' : 'c-warn'}">${live ? 'LIVE' : 'DEMO'}</dd></div>
        </dl>
      </div>`;
  }

  private conjunctionSection(state: SimulationState): string {
    const c = state.conjunction;
    const r = state.riskEvaluation;
    if (!c || !r) return '';
    return `<div class="p-section">
        <div class="eyebrow danger">${c.isConjunctionDetected ? 'Conjunction detected' : 'No conjunction'}</div>
        <dl class="metrics" style="margin-top:10px">
          <div class="lead"><dt>Miss distance</dt><dd>${fmtDistanceM(c.missDistanceMeters)}</dd></div>
          <div><dt>TCA</dt><dd>${fmtUtc(c.tcaDate)}<small>UTC</small></dd></div>
          <div><dt>Relative velocity</dt><dd>${c.relativeVelocityKmS.toFixed(2)}<small>km/s</small></dd></div>
          <div><dt>Risk</dt><dd class="${riskClass(r.riskLevel)}">${r.riskLevel}<span class="score">simulation score ${r.simulationRiskScore}/100</span></dd></div>
        </dl>
      </div>
      <div class="p-section">
        <p class="why"><b>WHY</b>${esc(whySummary(state))}</p>
      </div>`;
  }

  private threatLine(state: SimulationState): string {
    const c = state.conjunction;
    if (!c) return '';
    return `<div class="threat-line">
      Threat: ${fmtDistanceM(c.missDistanceMeters)} at ${fmtUtc(c.tcaDate)} UTC<br>
      Relative speed: ${c.relativeVelocityKmS.toFixed(2)} km/s
    </div>`;
  }

  private detailsSection(state: SimulationState): string {
    const p = state.provenance;
    if (!p) return '';
    const openDetails = this.detailsOpen.has('details') ? ' open' : '';
    const openScience = this.detailsOpen.has('science') ? ' open' : '';
    const openRefs = this.detailsOpen.has('refs') ? ' open' : '';

    const provenanceRows: string[] = [
      ['Data source', p.isLive ? 'CelesTrak GP (live)' : 'Offline baseline (demo)'],
      ['Object', `${p.objectName} · NORAD ${p.noradCatId}`],
      ['Format', 'CCSDS OMM (JSON) · OPM/OEM compatible'],
      ['Element epoch', p.epoch],
      ['Retrieved', p.retrievedAt.substring(0, 19).replace('T', ' ') + ' UTC'],
      ['Propagation', 'SGP4 initial state · RK4 + J2 maneuver model'],
      ['Scenario', 'Controlled synthetic conjunction'],
    ].map(([a, b]) => `<div class="row"><span>${a}</span><span>${esc(b)}</span></div>`);

    if (state.scenario && state.conjunction && state.riskEvaluation) {
      provenanceRows.push(
        `<div class="row"><span>Secondary</span><span>${esc(state.scenario.secondaryName)} · RCS ${state.scenario.secondaryRcsM2} m²</span></div>`,
        `<div class="row"><span>Secondary catalog</span><span>CelesTrak SATCAT / ESA DISCOS taxonomy</span></div>`,
        `<div class="row"><span>Conjunction standard</span><span>CCSDS 508.0-B-1 (CDM)</span></div>`,
        `<div class="row"><span>Safety threshold</span><span>${fmtDistanceM(state.conjunction.safetyThresholdMeters)}</span></div>`,
        `<p>${esc(state.riskEvaluation.formulaExplanation)}</p>`
      );
    }
    if (state.aiExplanation) {
      provenanceRows.push(
        `<p>${esc(state.aiExplanation.narrative)}</p>`,
        `<div class="notice">${state.aiExplanation.isFallback ? 'AI EXPLANATION UNAVAILABLE · ' : ''}${esc(state.aiExplanation.statusBadge)}. Physics computes the numbers; the optimizer chooses; the explanation layer only restates them.</div>`
      );
    }
    provenanceRows.push(
      `<div class="notice">SIMULATION SCENARIO · NOT A LIVE COLLISION EVENT. Prototype risk score, not an operational covariance-based Probability of Collision (Pc).</div>`
    );

    const scientificRows: string[] = [
      `<div class="row"><span>Propagation</span><span>SGP4 (mean elements) + RK4 Numerical (J2)</span></div>`,
      `<div class="row"><span>Equations of motion</span><span>dr/dt = v,  dv/dt = -μr/|r|³ + a_J2</span></div>`,
      `<div class="row"><span>Relative kinematics</span><span>r_rel = r_sec - r_pri,  d = |r_rel|</span></div>`,
      `<div class="row"><span>Closest approach</span><span>Sub-meter quadratic minimum search min_t d(t)</span></div>`,
      `<div class="row"><span>Maneuver model</span><span>Impulsive: v_after = v_before + Δv_RTN</span></div>`,
      `<div class="row"><span>Propellant proxy</span><span>Tsiolkovsky: Δm = m0 · (1 - e^(-Δv / (Isp·g0)))</span></div>`,
      `<div class="row"><span>Assumed spacecraft mass</span><span>420,000 kg (ISS nominal proxy)</span></div>`,
      `<div class="row"><span>Assumed Isp</span><span>305 s (hypergolic propulsion proxy)</span></div>`,
      `<div class="row"><span>Decision model</span><span>Score = 0.50·S_safe + 0.30·S_Δv + 0.20·S_impact - Penalty</span></div>`,
      `<div class="notice">DECISION-SUPPORT PROTOTYPE ONLY: Demonstrates verifiable physics and trade evaluation. Not certified operational flight software. Assumed fuel consumption is a simulation proxy, not live ISS operational telemetry.</div>`
    ];

    const refRows: string[] = [
      `<div class="row"><span>NASA CARA</span><span>Operational safety perimeters and conjunction risk assessment methodology.</span></div>`,
      `<div class="row"><span>CCSDS CDM (508.0-B-1)</span><span>International standard for exchange of Conjunction Data Messages.</span></div>`,
      `<div class="row"><span>CCSDS ODM (502.0-B-2)</span><span>Orbit Data Messages specification (OMM / OPM / OEM standard structures).</span></div>`,
      `<div class="row"><span>CelesTrak Current GP</span><span>Primary source for live NORAD General Perturbations element sets.</span></div>`,
      `<div class="row"><span>CelesTrak SATCAT</span><span>Space object catalog classification, identity, and operational status.</span></div>`,
      `<div class="row"><span>ESA DISCOS</span><span>Database and Information System Characterising Objects in Space.</span></div>`,
      `<div class="row"><span>NASA ODPO / ORDEM 3.2</span><span>Orbital Debris Program Office reference debris flux context.</span></div>`
    ];

    return `<div class="p-section">
      <details data-id="details"${openDetails}><summary>Technical Details & Provenance</summary><div class="details-body">${provenanceRows.join('')}</div></details>
      <details data-id="science"${openScience} style="margin-top:8px"><summary>Scientific Basis & Equations</summary><div class="details-body">${scientificRows.join('')}</div></details>
      <details data-id="refs"${openRefs} style="margin-top:8px"><summary>Authoritative References</summary><div class="details-body">${refRows.join('')}</div></details>
    </div>`;
  }

  /* ------------------------------------------------------------------ bottom */

  private bottomHtml(state: SimulationState, phase: Phase): string {
    if (phase === 'RESULT') return this.resultHtml(state);
    return '';
  }

  private resultHtml(state: SimulationState): string {
    const c = state.conjunction;
    const r = state.riskEvaluation;
    const pr = state.postManeuverRisk;
    if (!c || !r || !pr || state.postManeuverMissDistanceKm === null) return '';
    const afterM = state.postManeuverMissDistanceKm * 1000;
    const ok = state.isConjunctionMitigated;
    return `<div class="bottom-head"><h2>Before / After</h2><span>Recalculated from the re-propagated trajectory</span></div>
      <div class="ba">
        <div class="ba-col">
          <div class="eyebrow">Before maneuver</div>
          <div class="ba-val ${riskClass(r.riskLevel)}">${fmtDistanceM(c.missDistanceMeters)}</div>
          <div class="ba-risk ${riskClass(r.riskLevel)}">${r.riskLevel} RISK</div>
          <div class="ba-sub">score ${r.simulationRiskScore}/100</div>
        </div>
        <div class="ba-arrow">→</div>
        <div class="ba-col after">
          <div class="eyebrow">After maneuver</div>
          <div class="ba-val ${ok ? 'c-safe' : 'c-danger'}">${fmtDistanceM(afterM)}</div>
          <div class="ba-risk ${riskClass(pr.riskLevel)}">${pr.riskLevel} RISK</div>
          <div class="ba-sub">score ${pr.simulationRiskScore}/100</div>
        </div>
      </div>`;
  }
}
