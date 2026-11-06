export type Team = 'player' | 'enemy';
export type TargetKind = 'enemy' | 'ally' | 'empty' | 'any';
export type Shape = 'humanoid' | 'bird' | 'brute';

export interface PoisonEffect {
  damage: number;
  turns: number;
}

export interface Spell {
  id: string;
  name: string;
  icon: string;
  ap: number;
  minRange: number;
  maxRange: number;
  target: TargetKind;
  damage?: number;
  heal?: number;
  shield?: number;
  push?: number;
  aoe?: number;
  poison?: PoisonEffect;
  teleport?: boolean;
  color: string;
  description: string;
}

export interface Status {
  kind: 'poison';
  damage: number;
  turns: number;
  color: string;
  label: string;
}

export interface Fighter {
  id: string;
  name: string;
  kind: string;
  shape: Shape;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  mp: number;
  maxMp: number;
  initiative: number;
  shield: number;
  statuses: Status[];
  alive: boolean;
  spells: Spell[];
  color: string;
  accent: string;
  skin: string;
  flash: number;
  bobSeed: number;
}

export interface Tile {
  x: number;
  y: number;
}

export interface FighterSpec {
  name: string;
  kind: string;
  shape: Shape;
  team: Team;
  x: number;
  y: number;
  hp: number;
  ap: number;
  mp: number;
  initiative: number;
  spells: Spell[];
  color: string;
  accent: string;
  skin: string;
}

/** Rendering effects are addressed by grid tile so game logic stays render-agnostic. */
export interface FxSink {
  bolt(from: Tile, to: Tile, color: string): void;
  slash(at: Tile, color: string): void;
  ring(at: Tile, color: string, kind: 'heal' | 'shield'): void;
  teleport(from: Tile, to: Tile, color: string): void;
  text(at: Tile, text: string, color: string): void;
  shake(amount: number): void;
}
