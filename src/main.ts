import './style.css';
import { SimulationEngine } from './simulation/simulationEngine';
import { OrbitalScene } from './visualization/orbitalScene';
import { MissionControlUI } from './ui/missionControl';

const container = document.getElementById('canvas-container');
const tagLayer = document.getElementById('tag-layer');

if (container && tagLayer) {
  const scene = new OrbitalScene(container, tagLayer);
  const engine = new SimulationEngine();
  const ui = new MissionControlUI(engine, scene);

  // READY state: real primary orbit only. The secondary object is created by START SIMULATION.
  engine.initializePrimary().catch((err) => {
    console.error(err);
    ui.showError('ORBITAL DATA UNAVAILABLE');
  });
}
