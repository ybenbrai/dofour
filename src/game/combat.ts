import type { Fighter, FxSink, Spell, Team, Tile } from './types';
import {
  DIRS,
  GRID,
  hasLineOfSight,
  inBounds,
  key,
  manhattan,
  parseKey,
} from './grid';
import { createEnemyTeam, createPlayerTeam, OBSTACLES } from './data';

export interface ReachNode {
  cost: number;
  parent: string | null;
}

export interface LogEntry {
  text: string;
  color: string;
}

export interface AiAction {
  spell: Spell;
  tx: number;
  ty: number;
  score: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Combat {
  fighters: Fighter[];
  obstacles = new Set<string>();
  order: Fighter[];
  round = 1;
  turnIndex = 0;
  active: Fighter | null = null;
  state: 'player' | 'enemy' | 'over' = 'player';
  winner: Team | null = null;
  busy = false;
  aiRunning = false;
  log: LogEntry[] = [];
  version = 0;
  reachable = new Map<string, ReachNode>();
  fx: FxSink;

  constructor(fx: FxSink) {
    this.fx = fx;
    this.fighters = [...createPlayerTeam(), ...createEnemyTeam()];
    this.obstacles = new Set(OBSTACLES.map(([x, y]) => key(x, y)));
    this.order = [...this.fighters].sort(
      (a, b) => b.initiative - a.initiative || (a.team === b.team ? 0 : a.team === 'player' ? -1 : 1),
    );
    this.log.push({ text: 'Ambush! Defeat the creatures of Emberfall.', color: '#9fb4d8' });
    this.beginTurn(0);
  }

  // ---------------------------------------------------------------- queries

  fighterAt(x: number, y: number): Fighter | null {
    return this.fighters.find((f) => f.alive && f.x === x && f.y === y) ?? null;
  }

  isObstacle(x: number, y: number): boolean {
    return this.obstacles.has(key(x, y));
  }

  isBlockedTile(x: number, y: number): boolean {
    return !inBounds(x, y) || this.isObstacle(x, y) || this.fighterAt(x, y) !== null;
  }

  isWalkable(x: number, y: number): boolean {
    return inBounds(x, y) && !this.isBlockedTile(x, y);
  }

  canAct(): boolean {
    return this.state === 'player' && !this.busy && this.active?.team === 'player';
  }

  isOver(): boolean {
    return this.state === 'over';
  }

  isValidTarget(caster: Fighter, spell: Spell, tx: number, ty: number): boolean {
    if (!inBounds(tx, ty)) return false;
    if (this.isObstacle(tx, ty)) return false;
    const d = manhattan(caster, { x: tx, y: ty });
    if (d < spell.minRange || d > spell.maxRange) return false;

    const target = this.fighterAt(tx, ty);
    switch (spell.target) {
      case 'enemy':
        return (
          !!target &&
          target.team !== caster.team &&
          hasLineOfSight(this.obstacles, caster.x, caster.y, tx, ty)
        );
      case 'ally':
        return (
          !!target &&
          target.team === caster.team &&
          hasLineOfSight(this.obstacles, caster.x, caster.y, tx, ty)
        );
      case 'empty':
        return !target;
      case 'any':
        return hasLineOfSight(this.obstacles, caster.x, caster.y, tx, ty);
    }
  }

  validTargets(caster: Fighter, spell: Spell): Set<string> {
    const out = new Set<string>();
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        if (this.isValidTarget(caster, spell, x, y)) out.add(key(x, y));
      }
    }
    return out;
  }

  aoeTiles(tx: number, ty: number, radius: number): Tile[] {
    const out: Tile[] = [];
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        if (manhattan({ x, y }, { x: tx, y: ty }) <= radius) out.push({ x, y });
      }
    }
    return out;
  }

  computeReachable(f: Fighter): Map<string, ReachNode> {
    const out = new Map<string, ReachNode>();
    const start = key(f.x, f.y);
    out.set(start, { cost: 0, parent: null });
    const queue: Tile[] = [{ x: f.x, y: f.y }];

    while (queue.length) {
      const cur = queue.shift()!;
      const node = out.get(key(cur.x, cur.y))!;
      if (node.cost >= f.mp) continue;

      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!inBounds(nx, ny)) continue;
        const k = key(nx, ny);
        if (out.has(k)) continue;
        if (this.isBlockedTile(nx, ny)) continue;
        out.set(k, { cost: node.cost + 1, parent: key(cur.x, cur.y) });
        queue.push({ x: nx, y: ny });
      }
    }

    out.delete(start);
    return out;
  }

  pathTo(tx: number, ty: number): Tile[] {
    const path: Tile[] = [];
    let k: string | null = key(tx, ty);
    const seen = new Set<string>();

    while (k && this.reachable.has(k) && !seen.has(k)) {
      seen.add(k);
      path.push(parseKey(k));
      k = this.reachable.get(k)!.parent;
    }

    path.reverse();
    return path;
  }

  // ---------------------------------------------------------------- turns

  private advanceIndex(): void {
    this.turnIndex++;
    if (this.turnIndex >= this.order.length) {
      this.turnIndex = 0;
      this.round++;
    }
  }

  private beginTurn(index: number): void {
    this.turnIndex = index;
    let guard = 0;

    while (guard++ < 64) {
      const candidate = this.order[this.turnIndex];
      if (!candidate) return;
      if (candidate.alive) break;
      this.advanceIndex();
    }

    const f = this.order[this.turnIndex];
    if (!f) return;

    this.active = f;
    f.ap = f.maxAp;
    f.mp = f.maxMp;
    this.state = f.team === 'player' ? 'player' : 'enemy';

    this.log.push({
      text: `${f.name}'s turn.`,
      color: f.team === 'player' ? '#9fd0ff' : '#ff9f9f',
    });

    // Poison ticks at the start of the afflicted fighter's turn.
    for (const status of [...f.statuses]) {
      if (status.kind === 'poison') {
        this.damage(f, status.damage, '#b48cff');
        status.turns--;
        if (status.turns <= 0) {
          f.statuses = f.statuses.filter((s) => s !== status);
        }
      }
    }

    if (!f.alive) {
      if (!this.isOver()) this.nextTurn();
      return;
    }

    this.touch();
  }

  nextTurn(): void {
    if (this.state === 'over') return;
    this.advanceIndex();
    this.beginTurn(this.turnIndex);
  }

  touch(): void {
    if (this.state !== 'over' && this.active?.team === 'player') {
      this.reachable = this.computeReachable(this.active);
    } else {
      this.reachable = new Map();
    }
    this.version++;
  }

  // ---------------------------------------------------------------- actions

  async movePlayer(f: Fighter, tx: number, ty: number): Promise<void> {
    if (!this.canAct() || this.active !== f) return;
    const node = this.reachable.get(key(tx, ty));
    if (!node || node.cost <= 0 || node.cost > f.mp) return;

    const path = this.pathTo(tx, ty);
    if (!path.length) return;

    f.mp -= node.cost;
    this.log.push({
      text: `${f.name} moves ${node.cost} tile${node.cost > 1 ? 's' : ''}.`,
      color: '#8fa8c8',
    });
    await this.moveAlong(f, path);
  }

  private async moveAlong(f: Fighter, path: Tile[]): Promise<void> {
    this.busy = true;
    for (const step of path) {
      f.x = step.x;
      f.y = step.y;
      this.version++;
      await sleep(90);
    }
    this.busy = false;
    this.touch();
  }

  async cast(f: Fighter, spell: Spell, tx: number, ty: number): Promise<boolean> {
    if (this.state === 'over' || this.busy) return false;
    if (this.active !== f || f.team !== 'player') return false;
    if (f.ap < spell.ap) return false;
    if (!this.isValidTarget(f, spell, tx, ty)) return false;

    this.busy = true;
    await this.performCast(f, spell, tx, ty);
    this.busy = false;
    this.touch();
    return true;
  }

  private async performCast(f: Fighter, spell: Spell, tx: number, ty: number): Promise<void> {
    f.ap -= spell.ap;
    const target = this.fighterAt(tx, ty);
    const at: Tile = { x: tx, y: ty };

    if (spell.teleport) {
      this.fx.teleport({ x: f.x, y: f.y }, at, spell.color);
      f.x = tx;
      f.y = ty;
      this.log.push({ text: `${f.name} leaps across the battlefield.`, color: '#8fd4ff' });
      await sleep(280);
      return;
    }

    if (spell.heal || spell.shield) {
      if (!target) return;
      this.fx.ring(at, spell.color, spell.heal ? 'heal' : 'shield');
      await sleep(120);

      if (spell.heal) {
        const healed = this.heal(target, spell.heal);
        this.log.push({
          text: `${f.name} heals ${target.name} for ${healed} HP.`,
          color: '#8fe0b0',
        });
      }
      if (spell.shield) {
        target.shield = Math.min(80, target.shield + spell.shield);
        this.fx.text(at, `+${spell.shield} shield`, '#7fd8ff');
        this.log.push({
          text: `${f.name} shields ${target.name} for ${spell.shield}.`,
          color: '#8fd4ff',
        });
      }
      if (spell.push && target !== f) this.push(f, target, spell.push);
      await sleep(220);
      return;
    }

    const targets = spell.aoe
      ? this.fighters.filter(
          (o) =>
            o.alive &&
            o.team !== f.team &&
            manhattan(o, at) <= (spell.aoe ?? 0),
        )
      : target && target.alive && target.team !== f.team
        ? [target]
        : [];

    this.fx.bolt({ x: f.x, y: f.y }, at, spell.color);
    await sleep(170);
    this.fx.slash(at, spell.color);
    this.fx.shake(2);

    if (targets.length) {
      this.log.push({
        text: `${f.name} casts ${spell.name} on ${targets.map((t) => t.name).join(', ')}.`,
        color: f.team === 'player' ? '#ffd9a0' : '#ffb0b0',
      });
    }

    for (const t of targets) {
      this.damage(t, spell.damage ?? 0);
      if (spell.poison && t.alive) this.applyPoison(t, spell.poison.damage, spell.poison.turns);
      if (spell.push && t.alive) this.push(f, t, spell.push);
    }

    await sleep(200);
  }

  private applyPoison(target: Fighter, damage: number, turns: number): void {
    const existing = target.statuses.find((s) => s.kind === 'poison');
    if (existing) {
      existing.damage = Math.max(existing.damage, damage);
      existing.turns = Math.max(existing.turns, turns);
    } else {
      target.statuses.push({
        kind: 'poison',
        damage,
        turns,
        color: '#b48cff',
        label: 'Poison',
      });
    }
  }

  damage(target: Fighter, base: number, color = '#ff7070'): number {
    if (!target.alive || base <= 0) return 0;

    const roll = 0.9 + Math.random() * 0.2;
    let dmg = Math.max(1, Math.round(base * roll));

    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) this.fx.text({ x: target.x, y: target.y }, `-${absorbed} shield`, '#7fd8ff');
    }

    target.hp = Math.max(0, target.hp - dmg);
    target.flash = 1;
    this.fx.shake(2 + Math.min(6, dmg * 0.16));

    if (dmg > 0) {
      this.fx.text({ x: target.x, y: target.y }, `-${dmg}`, color);
    }

    if (target.hp <= 0 && target.alive) {
      target.alive = false;
      this.fx.text({ x: target.x, y: target.y }, 'KO', '#ffd166');
      this.log.push({ text: `${target.name} is defeated!`, color: '#ffd166' });
      this.checkEnd();
    }

    return dmg;
  }

  private heal(target: Fighter, amount: number): number {
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const healed = target.hp - before;
    this.fx.text({ x: target.x, y: target.y }, `+${healed}`, '#6fe0a0');
    return healed;
  }

  private push(source: Fighter, target: Fighter, steps: number): void {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    let sx = 0;
    let sy = 0;
    if (Math.abs(dx) >= Math.abs(dy)) sx = Math.sign(dx);
    else sy = Math.sign(dy);
    if (sx === 0 && sy === 0) return;

    let moved = 0;
    for (let i = 0; i < steps; i++) {
      const nx = target.x + sx;
      const ny = target.y + sy;
      if (!this.isWalkable(nx, ny)) break;
      target.x = nx;
      target.y = ny;
      moved++;
    }

    if (moved > 0) {
      this.fx.text({ x: target.x, y: target.y }, `push ${moved}`, '#c8d6ff');
      this.fx.shake(3);
    }
  }

  private checkEnd(): void {
    if (this.state === 'over') return;
    const playersAlive = this.fighters.some((f) => f.alive && f.team === 'player');
    const enemiesAlive = this.fighters.some((f) => f.alive && f.team === 'enemy');

    if (!enemiesAlive) {
      this.state = 'over';
      this.winner = 'player';
      this.log.push({ text: 'Victory! The ambush is broken.', color: '#ffd166' });
      this.version++;
    } else if (!playersAlive) {
      this.state = 'over';
      this.winner = 'enemy';
      this.log.push({ text: 'Defeat. The party has fallen.', color: '#ff8a8a' });
      this.version++;
    }
  }

  // ---------------------------------------------------------------- AI

  private hasAttackTarget(f: Fighter): boolean {
    for (const spell of f.spells) {
      if (spell.ap > f.ap) continue;
      if (spell.target !== 'enemy' && spell.target !== 'any') continue;
      for (const p of this.fighters) {
        if (!p.alive || p.team === f.team) continue;
        if (this.isValidTarget(f, spell, p.x, p.y)) return true;
      }
    }
    return false;
  }

  private aiApproachPath(f: Fighter): Tile[] {
    const enemies = this.fighters.filter((o) => o.alive && o.team !== f.team);
    if (!enemies.length) return [];

    const reach = this.computeReachable(f);
    let bestKey = key(f.x, f.y);
    let bestScore = Infinity;

    const consider = (x: number, y: number, cost: number) => {
      const dist = Math.min(...enemies.map((e) => manhattan({ x, y }, e)));
      const inRange = f.spells.some(
        (s) =>
          s.target === 'enemy' &&
          s.ap <= f.maxAp &&
          dist >= s.minRange &&
          dist <= s.maxRange,
      );
      const score = dist * 10 - (inRange ? 18 : 0) + cost * 0.1;
      if (score < bestScore) {
        bestScore = score;
        bestKey = key(x, y);
      }
    };

    consider(f.x, f.y, 0);
    for (const [k, node] of reach) {
      const { x, y } = parseKey(k);
      consider(x, y, node.cost);
    }

    if (bestKey === key(f.x, f.y)) return [];

    const path: Tile[] = [];
    let k: string | null = bestKey;
    const seen = new Set<string>();
    while (k && reach.has(k) && !seen.has(k)) {
      seen.add(k);
      path.push(parseKey(k));
      k = reach.get(k)!.parent;
    }
    path.reverse();
    return path;
  }

  private aiPickAction(f: Fighter): AiAction | null {
    let best: AiAction | null = null;

    for (const spell of f.spells) {
      if (spell.ap > f.ap || !spell.damage) continue;
      if (spell.target !== 'enemy' && spell.target !== 'any') continue;

      for (const p of this.fighters) {
        if (!p.alive || p.team === f.team) continue;
        if (!this.isValidTarget(f, spell, p.x, p.y)) continue;

        let score = spell.damage;
        if (p.hp <= spell.damage) score += 60;
        score += (1 - p.hp / p.maxHp) * 10;

        if (spell.aoe) {
          const splash = this.fighters.filter(
            (o) =>
              o.alive &&
              o.team !== f.team &&
              o.id !== p.id &&
              manhattan(o, p) <= (spell.aoe ?? 0),
          );
          score += splash.length * spell.damage * 0.7;
        }
        if (spell.poison) {
          score += spell.poison.damage * spell.poison.turns * 0.6;
        }

        if (!best || score > best.score) {
          best = { spell, tx: p.x, ty: p.y, score };
        }
      }
    }

    return best;
  }

  async runEnemyTurn(): Promise<void> {
    const f = this.active;
    if (!f || this.state !== 'enemy' || this.aiRunning) return;

    this.aiRunning = true;
    this.busy = true;
    await sleep(520);

    if (!f.alive || this.isOver()) {
      this.finishAi();
      return;
    }

    if (!this.hasAttackTarget(f)) {
      const path = this.aiApproachPath(f);
      const steps = path.slice(0, f.mp);
      if (steps.length) {
        f.mp -= steps.length;
        this.log.push({ text: `${f.name} advances.`, color: '#ffb0b0' });
        for (const step of steps) {
          f.x = step.x;
          f.y = step.y;
          this.version++;
          await sleep(95);
        }
      }
    }

    await sleep(260);

    let guard = 10;
    while (guard-- > 0 && f.alive && !this.isOver()) {
      const action = this.aiPickAction(f);
      if (!action) break;
      await this.performCast(f, action.spell, action.tx, action.ty);
      this.touch();
      await sleep(220);
    }

    this.finishAi();
  }

  private finishAi(): void {
    this.busy = false;
    this.aiRunning = false;
    if (!this.isOver()) this.nextTurn();
    this.touch();
  }
}
