import './style.css';
import { Combat } from './game/combat';
import { Renderer, type ViewState } from './render/renderer';
import { UI } from './ui';
import { key } from './game/grid';
import type { Spell, Tile } from './game/types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
let combat = new Combat(renderer);

let selectedSpell: Spell | null = null;
let validTargets = new Set<string>();
let path: Tile[] = [];
let hover: Tile | null = null;
let lastVersion = -1;
let aiLoopRunning = false;

const ui = new UI({ selectSpell, endTurn, restart });

// ------------------------------------------------------------------ layout

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.resize(window.innerWidth, window.innerHeight, dpr);
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ view

function computeView(): void {
  validTargets = new Set();
  path = [];
  const active = combat.active;
  if (!active || !combat.canAct()) return;

  if (selectedSpell) {
    validTargets = combat.validTargets(active, selectedSpell);
  } else if (hover && combat.reachable.has(key(hover.x, hover.y))) {
    path = combat.pathTo(hover.x, hover.y);
  }
}

function refresh(): void {
  computeView();
  ui.refresh(combat);
}

function selectSpell(spell: Spell | null): void {
  if (combat.state === 'over') return;
  if (spell && !combat.canAct()) return;
  selectedSpell = spell;
  ui.setSelected(spell);
  refresh();
}

// ------------------------------------------------------------------ actions

async function onClick(event: MouseEvent): Promise<void> {
  if (!combat.canAct()) return;
  const active = combat.active;
  if (!active) return;

  const tile = renderer.toTile(event.clientX, event.clientY);
  if (!tile) {
    selectSpell(null);
    return;
  }

  if (selectedSpell) {
    if (combat.isValidTarget(active, selectedSpell, tile.x, tile.y)) {
      const spell = selectedSpell;
      selectedSpell = null;
      ui.setSelected(null);
      refresh();
      await combat.cast(active, spell, tile.x, tile.y);
      refresh();
    } else {
      selectSpell(null);
    }
    return;
  }

  if (combat.reachable.has(key(tile.x, tile.y))) {
    await combat.movePlayer(active, tile.x, tile.y);
    refresh();
  }
}

async function endTurn(): Promise<void> {
  if (!combat.canAct()) return;
  selectedSpell = null;
  ui.setSelected(null);
  combat.nextTurn();
  refresh();
  await driveAI();
}

async function driveAI(): Promise<void> {
  if (aiLoopRunning) return;
  aiLoopRunning = true;

  while (combat.state === 'enemy') {
    await combat.runEnemyTurn();
    refresh();
    await new Promise((r) => setTimeout(r, 160));
  }

  aiLoopRunning = false;
  refresh();
}

function restart(): void {
  renderer.clearFx();
  combat = new Combat(renderer);
  selectedSpell = null;
  hover = null;
  validTargets = new Set();
  path = [];
  lastVersion = -1;
  ui.setSelected(null);
  refresh();
  void driveAI();
}

// ------------------------------------------------------------------ input

canvas.addEventListener('mousemove', (event) => {
  const tile = renderer.toTile(event.clientX, event.clientY);
  if (tile?.x === hover?.x && tile?.y === hover?.y) return;
  hover = tile;
  computeView();
});

canvas.addEventListener('mouseleave', () => {
  hover = null;
  computeView();
});

canvas.addEventListener('click', (event) => {
  void onClick(event);
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  selectSpell(null);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') selectSpell(null);
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (/^[1-9]$/.test(event.key) && combat.canAct()) {
    const active = combat.active;
    const index = Number(event.key) - 1;
    if (active && index < active.spells.length) {
      const spell = active.spells[index];
      selectSpell(spell === selectedSpell ? null : spell);
    }
    return;
  }

  if (event.key === 'Enter' && combat.canAct()) {
    event.preventDefault();
    void endTurn();
  }
});

// ------------------------------------------------------------------ loop

let lastTime = performance.now();

function frame(now: number): void {
  const dt = Math.min(50, now - lastTime);
  lastTime = now;

  renderer.update(dt, combat);

  const view: ViewState = {
    hover,
    selectedSpell,
    validTargets,
    path,
    canAct: combat.canAct(),
    time: now / 1000,
  };
  renderer.draw(combat, view);

  if (combat.version !== lastVersion) {
    lastVersion = combat.version;
    ui.refresh(combat);
  }

  requestAnimationFrame(frame);
}

refresh();
void driveAI();
requestAnimationFrame(frame);

declare global {
  interface Window {
    __emberfall?: {
      getCombat: () => Combat;
      renderer: Renderer;
      endTurn: () => Promise<void>;
      driveAI: () => Promise<void>;
    };
  }
}

window.__emberfall = {
  getCombat: () => combat,
  renderer,
  endTurn,
  driveAI,
};
