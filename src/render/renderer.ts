import type { Combat } from '../game/combat';
import type { Fighter, FxSink, Spell, Tile } from '../game/types';
import {
  GRID,
  TILE_H,
  TILE_W,
  WORLD_H,
  WORLD_W,
  key,
  parseKey,
  screenToTile,
  tilePos,
} from '../game/grid';

export interface ViewState {
  hover: Tile | null;
  selectedSpell: Spell | null;
  validTargets: Set<string>;
  path: Tile[];
  canAct: boolean;
  time: number;
}

interface Effect {
  kind: 'bolt' | 'slash' | 'ring' | 'teleport';
  from?: Tile;
  to?: Tile;
  at?: Tile;
  color: string;
  healKind?: 'heal' | 'shield';
  t: number;
  life: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
  life: number;
}

interface Dust {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
  color: string;
}

const TEAM_COLOR: Record<string, string> = {
  player: '#5fb0ff',
  enemy: '#ff6b6b',
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Renderer implements FxSink {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private time = 0;
  private effects: Effect[] = [];
  private floaters: Floater[] = [];
  private shakeAmt = 0;
  private dust: Dust[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;

    const colors = ['#6fb4ff', '#e8c37a', '#ff8a5c', '#8fd4ff'];
    for (let i = 0; i < 46; i++) {
      this.dust.push({
        x: 20 + Math.random() * (WORLD_W - 40),
        y: 30 + Math.random() * (WORLD_H - 60),
        speed: 4 + Math.random() * 10,
        size: 0.7 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    const left = w > 1120 ? 276 : w > 840 ? 224 : 16;
    const top = 82;
    const bottom = h > 780 ? 184 : 158;
    const availW = Math.max(200, w - left - 20);
    const availH = Math.max(180, h - top - bottom);
    this.scale = Math.max(0.34, Math.min(availW / WORLD_W, availH / WORLD_H));
    this.offX = left + (availW - WORLD_W * this.scale) / 2;
    this.offY = top + (availH - WORLD_H * this.scale) / 2;
  }

  toTile(clientX: number, clientY: number): Tile | null {
    const rect = this.canvas.getBoundingClientRect();
    return screenToTile(
      clientX - rect.left,
      clientY - rect.top,
      this.offX,
      this.offY,
      this.scale,
    );
  }

  tileToScreen(x: number, y: number): { x: number; y: number } {
    const p = tilePos(x, y);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + this.offX + p.x * this.scale,
      y: rect.top + this.offY + p.y * this.scale,
    };
  }

  update(dt: number, combat: Combat): void {
    this.time += dt;
    const smooth = 1 - Math.pow(2e-8, dt / 1000);

    for (const f of combat.fighters) {
      const target = tilePos(f.x, f.y);
      f.vx = lerp(f.vx, target.x, smooth);
      f.vy = lerp(f.vy, target.y, smooth);
      if (Math.abs(f.vx - target.x) < 0.4) f.vx = target.x;
      if (Math.abs(f.vy - target.y) < 0.4) f.vy = target.y;
      f.flash = Math.max(0, f.flash - dt / 260);
    }

    for (const e of this.effects) e.t += dt / 1000;
    this.effects = this.effects.filter((e) => e.t < e.life);

    for (const f of this.floaters) f.t += dt / 1000;
    this.floaters = this.floaters.filter((f) => f.t < f.life);

    this.shakeAmt *= Math.pow(0.002, dt / 1000);
    if (this.shakeAmt < 0.05) this.shakeAmt = 0;

    for (const d of this.dust) {
      d.y -= (d.speed * dt) / 1000;
      d.x += Math.sin(this.time / 900 + d.phase) * 0.15;
      if (d.y < 20) {
        d.y = WORLD_H - 20;
        d.x = 20 + Math.random() * (WORLD_W - 40);
      }
    }
  }

  // --------------------------------------------------------------- FxSink

  clearFx(): void {
    this.effects = [];
    this.floaters = [];
    this.shakeAmt = 0;
  }

  bolt(from: Tile, to: Tile, color: string): void {
    this.effects.push({ kind: 'bolt', from, to, color, t: 0, life: 0.42 });
  }

  slash(at: Tile, color: string): void {
    this.effects.push({ kind: 'slash', at, color, t: 0, life: 0.34 });
  }

  ring(at: Tile, color: string, kind: 'heal' | 'shield'): void {
    this.effects.push({ kind: 'ring', at, color, healKind: kind, t: 0, life: 0.6 });
  }

  teleport(from: Tile, to: Tile, color: string): void {
    this.effects.push({ kind: 'teleport', from, to, color, t: 0, life: 0.55 });
  }

  text(at: Tile, text: string, color: string): void {
    const p = tilePos(at.x, at.y);
    this.floaters.push({
      x: p.x + (Math.random() - 0.5) * 16,
      y: p.y - 58,
      text,
      color,
      t: 0,
      life: 1.05,
    });
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(9, this.shakeAmt + amount);
  }

  // --------------------------------------------------------------- draw

  draw(combat: Combat, view: ViewState): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const bg = ctx.createLinearGradient(0, 0, 0, this.h);
    bg.addColorStop(0, '#0a1220');
    bg.addColorStop(0.55, '#070d16');
    bg.addColorStop(1, '#05080e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.w, this.h);

    const glow = ctx.createRadialGradient(
      this.w * 0.55,
      this.h * 0.36,
      40,
      this.w * 0.55,
      this.h * 0.36,
      Math.max(this.w, this.h) * 0.65,
    );
    glow.addColorStop(0, 'rgba(58, 98, 150, 0.16)');
    glow.addColorStop(0.55, 'rgba(20, 40, 70, 0.05)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.w, this.h);

    const sx = (Math.random() - 0.5) * this.shakeAmt;
    const sy = (Math.random() - 0.5) * this.shakeAmt;

    ctx.save();
    ctx.translate(this.offX + sx, this.offY + sy);
    ctx.scale(this.scale, this.scale);

    this.drawDust();
    this.drawTiles();
    this.drawHighlights(combat, view);
    this.drawEntities(combat, view);
    this.drawEffects();
    this.drawFloaters();

    ctx.restore();

    const vignette = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.32,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.75,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private diamond(cx: number, cy: number, inset = 0): void {
    const hw = TILE_W / 2 - inset;
    const hh = TILE_H / 2 - inset / 2;
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
  }

  private drawTiles(): void {
    const { ctx } = this;
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        const p = tilePos(x, y);
        const even = (x + y) % 2 === 0;
        ctx.fillStyle = even ? '#162533' : '#13202c';
        this.diamond(p.x, p.y, 1);
        ctx.fill();

        ctx.strokeStyle = even ? 'rgba(120,180,235,0.07)' : 'rgba(120,180,235,0.045)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  private drawHighlights(combat: Combat, view: ViewState): void {
    const { ctx } = this;
    const pulse = 0.75 + Math.sin(this.time / 420) * 0.25;

    if (view.canAct && !view.selectedSpell) {
      for (const k of combat.reachable.keys()) {
        const p = tilePos(parseKey(k).x, parseKey(k).y);
        ctx.fillStyle = 'rgba(84, 166, 255, 0.13)';
        this.diamond(p.x, p.y, 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 200, 255, 0.16)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (view.path.length) {
        for (const t of view.path) {
          const p = tilePos(t.x, t.y);
          ctx.fillStyle = `rgba(140, 215, 255, ${0.24 * pulse})`;
          this.diamond(p.x, p.y, 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(190, 235, 255, 0.7)';
          ctx.fill();
        }

        if (view.hover) {
          const hp = tilePos(view.hover.x, view.hover.y);
          const label = `${view.path.length} MP`;
          ctx.font = '700 10px Inter, system-ui, sans-serif';
          const tw = ctx.measureText(label).width;
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(7, 11, 18, 0.92)';
          ctx.strokeStyle = 'rgba(127, 216, 255, 0.55)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(hp.x - tw / 2 - 6, hp.y - 46, tw + 12, 16, 8);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#bfe4ff';
          ctx.fillText(label, hp.x, hp.y - 34.5);
        }
      }
    }

    if (view.selectedSpell && view.canAct) {
      const spell = view.selectedSpell;
      const base =
        spell.target === 'enemy'
          ? '255, 90, 90'
          : spell.target === 'ally'
            ? '111, 224, 160'
            : '127, 216, 255';
      for (const k of view.validTargets) {
        const t = parseKey(k);
        const p = tilePos(t.x, t.y);
        ctx.fillStyle = `rgba(${base}, ${0.2 * pulse})`;
        this.diamond(p.x, p.y, 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${base}, 0.45)`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      if (spell.aoe && view.hover && view.validTargets.has(key(view.hover.x, view.hover.y))) {
        for (const t of combat.aoeTiles(view.hover.x, view.hover.y, spell.aoe)) {
          const p = tilePos(t.x, t.y);
          ctx.fillStyle = 'rgba(255, 150, 70, 0.16)';
          this.diamond(p.x, p.y, 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 170, 90, 0.4)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    if (view.hover) {
      const p = tilePos(view.hover.x, view.hover.y);
      ctx.strokeStyle = 'rgba(232, 195, 122, 0.75)';
      ctx.lineWidth = 1.6;
      this.diamond(p.x, p.y, 1);
      ctx.stroke();
    }
  }

  private drawDust(): void {
    const { ctx } = this;
    ctx.save();
    for (const d of this.dust) {
      const alpha = 0.08 + (Math.sin(this.time / 700 + d.phase) + 1) * 0.05;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawEntities(combat: Combat, view: ViewState): void {
    const drawables: Array<{ depth: number; draw: () => void }> = [];

    for (const k of combat.obstacles) {
      const t = parseKey(k);
      drawables.push({
        depth: t.x + t.y + 0.05,
        draw: () => this.drawRock(t.x, t.y),
      });
    }

    for (const f of combat.fighters) {
      drawables.push({
        depth: f.x + f.y + (f.alive ? 0.2 : 0.1),
        draw: () => this.drawFighter(f, combat, view),
      });
    }

    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) d.draw();
  }

  private drawRock(x: number, y: number): void {
    const { ctx } = this;
    const p = tilePos(x, y);
    const seed = ((x * 73856093) ^ (y * 19349663)) % 100;
    const lift = 2 + (seed % 5);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 6, 22, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#26384a';
    ctx.strokeStyle = '#3d566e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x - 17, p.y + lift);
    ctx.lineTo(p.x - 9, p.y - 20 - lift);
    ctx.lineTo(p.x + 3, p.y - 28 - lift);
    ctx.lineTo(p.x + 16, p.y - 6);
    ctx.lineTo(p.x + 7, p.y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38506a';
    ctx.beginPath();
    ctx.moveTo(p.x - 9, p.y - 20 - lift);
    ctx.lineTo(p.x + 3, p.y - 28 - lift);
    ctx.lineTo(p.x + 10, p.y - 15 - lift);
    ctx.lineTo(p.x - 2, p.y - 11 - lift);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(103, 150, 108, 0.55)';
    ctx.beginPath();
    ctx.arc(p.x - 5, p.y - 16 - lift, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFighter(f: Fighter, combat: Combat, view: ViewState): void {
    const { ctx } = this;

    if (!f.alive) {
      const p = tilePos(f.x, f.y);
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 4, 15, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3c4b5d';
      ctx.strokeStyle = '#5c7088';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(p.x - 9, p.y - 24, 18, 24, 6);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#7b90a8';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 19);
      ctx.lineTo(p.x, p.y - 8);
      ctx.moveTo(p.x - 5, p.y - 15);
      ctx.lineTo(p.x + 5, p.y - 15);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const bob = Math.sin(this.time / 380 + f.bobSeed) * 1.3;
    const p = { x: f.vx, y: f.vy + bob };
    const teamColor = TEAM_COLOR[f.team] ?? '#ffffff';

    // shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
    ctx.beginPath();
    ctx.ellipse(f.vx, f.vy + 3, 16, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // team ring
    ctx.strokeStyle = teamColor;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(f.vx, f.vy + 2, 17, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // active ring
    if (combat.active === f && view.canAct) {
      const r = 20 + Math.sin(this.time / 260) * 1.5;
      ctx.strokeStyle = 'rgba(232, 195, 122, 0.9)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -this.time / 60;
      ctx.beginPath();
      ctx.ellipse(f.vx, f.vy + 2, r, r * 0.46, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (f.shape === 'bird') {
      this.drawBird(f, p);
    } else {
      this.drawHumanoid(f, p, f.shape === 'brute' ? 1.22 : 1);
    }

    if (f.flash > 0) {
      ctx.save();
      ctx.globalAlpha = f.flash * 0.4;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(f.vx, p.y - 26, 15, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    this.drawFighterBar(f, combat, view, teamColor);
  }

  private drawHumanoid(f: Fighter, p: { x: number; y: number }, s: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s, s);

    // robe
    ctx.fillStyle = f.color;
    ctx.strokeStyle = f.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, -4);
    ctx.quadraticCurveTo(-15, -26, -8, -33);
    ctx.lineTo(8, -33);
    ctx.quadraticCurveTo(15, -26, 12, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // belt
    ctx.fillStyle = f.accent;
    ctx.fillRect(-10, -19, 20, 3);

    // hood
    ctx.fillStyle = f.accent;
    ctx.beginPath();
    ctx.arc(0, -43, 11, 0, Math.PI * 2);
    ctx.fill();

    // face
    ctx.fillStyle = f.skin;
    ctx.beginPath();
    ctx.arc(0, -40.5, 8, 0, Math.PI * 2);
    ctx.fill();

    // eyes
    ctx.fillStyle = '#1a2230';
    ctx.beginPath();
    ctx.arc(-3, -41, 1.25, 0, Math.PI * 2);
    ctx.arc(3, -41, 1.25, 0, Math.PI * 2);
    ctx.fill();

    if (f.kind === 'goblin') {
      ctx.fillStyle = f.skin;
      ctx.beginPath();
      ctx.moveTo(-9, -44);
      ctx.lineTo(-17, -49);
      ctx.lineTo(-9, -48);
      ctx.closePath();
      ctx.moveTo(9, -44);
      ctx.lineTo(17, -49);
      ctx.lineTo(9, -48);
      ctx.closePath();
      ctx.fill();
    }

    if (f.shape === 'brute') {
      ctx.fillStyle = '#e8dcc0';
      ctx.beginPath();
      ctx.moveTo(-7, -51);
      ctx.lineTo(-12, -61);
      ctx.lineTo(-3, -53);
      ctx.closePath();
      ctx.moveTo(7, -51);
      ctx.lineTo(12, -61);
      ctx.lineTo(3, -53);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, -36);
      ctx.lineTo(-3, -32);
      ctx.lineTo(-1, -36);
      ctx.closePath();
      ctx.moveTo(4, -36);
      ctx.lineTo(3, -32);
      ctx.lineTo(1, -36);
      ctx.closePath();
      ctx.fill();
    }

    this.drawEmblem(f, 0, -24);
    this.drawWeapon(f);
    ctx.restore();
  }

  private drawEmblem(f: Fighter, x: number, y: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(255, 245, 220, 0.85)';
    ctx.fillStyle = 'rgba(255, 245, 220, 0.85)';
    ctx.lineWidth = 1.5;

    if (f.kind === 'iop') {
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(0, 5);
      ctx.moveTo(-4, -1);
      ctx.lineTo(4, -1);
      ctx.stroke();
    } else if (f.kind === 'cra') {
      ctx.beginPath();
      ctx.arc(-2, 0, 5, -Math.PI / 2.4, Math.PI / 2.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(1, -4);
      ctx.lineTo(1, 4);
      ctx.stroke();
    } else if (f.kind === 'eniripsa') {
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
      ctx.moveTo(0, -4);
      ctx.lineTo(0, 4);
      ctx.stroke();
    } else if (f.kind === 'goblin') {
      ctx.beginPath();
      ctx.moveTo(-3, -4);
      ctx.lineTo(2, 0);
      ctx.lineTo(-3, 4);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawWeapon(f: Fighter): void {
    const { ctx } = this;
    ctx.save();
    if (f.kind === 'iop') {
      ctx.strokeStyle = '#dbe7f5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, -18);
      ctx.lineTo(17, -39);
      ctx.stroke();
      ctx.strokeStyle = '#8a6a3f';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(8, -22);
      ctx.lineTo(14, -17);
      ctx.stroke();
    } else if (f.kind === 'cra') {
      ctx.strokeStyle = '#c9a26a';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(-15, -26, 10, -1.12, 1.12);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230, 235, 245, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-10.4, -35);
      ctx.lineTo(-10.4, -17);
      ctx.stroke();
    } else if (f.kind === 'eniripsa') {
      ctx.strokeStyle = '#8a6a3f';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(13, -3);
      ctx.lineTo(13, -38);
      ctx.stroke();
      ctx.fillStyle = '#8fd4ff';
      ctx.shadowColor = '#8fd4ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(13, -40, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (f.kind === 'goblin') {
      ctx.strokeStyle = '#d5dde8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, -16);
      ctx.lineTo(16, -29);
      ctx.stroke();
      ctx.strokeStyle = '#6e4a24';
      ctx.beginPath();
      ctx.moveTo(8, -19);
      ctx.lineTo(13, -15);
      ctx.stroke();
    } else if (f.kind === 'bwork') {
      ctx.strokeStyle = '#7a5a3a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(11, -6);
      ctx.lineTo(18, -30);
      ctx.stroke();
      ctx.fillStyle = '#5c4128';
      ctx.beginPath();
      ctx.arc(18, -32, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBird(f: Fighter, p: { x: number; y: number }): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(p.x, p.y);

    ctx.fillStyle = f.color;
    ctx.strokeStyle = f.accent;
    ctx.lineWidth = 2;

    // tail
    ctx.beginPath();
    ctx.moveTo(-9, -13);
    ctx.lineTo(-20, -19);
    ctx.lineTo(-9, -8);
    ctx.closePath();
    ctx.fill();

    // body
    ctx.beginPath();
    ctx.ellipse(0, -14, 12, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // wing
    ctx.fillStyle = f.accent;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(-5, -14, 5, 7, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // head
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(0, -27, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // beak
    ctx.fillStyle = '#e8963f';
    ctx.beginPath();
    ctx.moveTo(6, -28);
    ctx.lineTo(14, -25.5);
    ctx.lineTo(6, -23.5);
    ctx.closePath();
    ctx.fill();

    // eye
    ctx.fillStyle = '#1a2230';
    ctx.beginPath();
    ctx.arc(2.5, -29, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // feet
    ctx.strokeStyle = '#e8963f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-4, -4);
    ctx.lineTo(-4, 0);
    ctx.moveTo(4, -4);
    ctx.lineTo(4, 0);
    ctx.stroke();

    ctx.restore();
  }

  private drawFighterBar(
    f: Fighter,
    combat: Combat,
    view: ViewState,
    teamColor: string,
  ): void {
    const { ctx } = this;
    const offset = f.shape === 'brute' ? 74 : f.shape === 'bird' ? 50 : 64;
    const w = 42;
    const h = 5;
    const bx = f.vx - w / 2;
    const by = f.vy - offset;

    const hovered =
      !!view.hover && view.hover.x === f.x && view.hover.y === f.y;
    if (combat.active === f || hovered) {
      ctx.font = '600 9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(215, 228, 245, 0.88)';
      ctx.fillText(f.name, f.vx, by - 4);
    }

    ctx.fillStyle = 'rgba(4, 8, 14, 0.78)';
    ctx.beginPath();
    ctx.roundRect(bx - 1, by - 1, w + 2, h + 2, 3);
    ctx.fill();

    const pct = Math.max(0, f.hp / f.maxHp);
    ctx.fillStyle = pct > 0.5 ? '#5ddc7a' : pct > 0.25 ? '#f2c14e' : '#ff5f5f';
    ctx.beginPath();
    ctx.roundRect(bx, by, w * pct, h, 2);
    ctx.fill();

    if (f.shield > 0) {
      ctx.strokeStyle = '#7fd8ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(bx - 2, by - 2, w + 4, h + 4, 4);
      ctx.stroke();
    }

    let dotX = bx + w + 6;
    for (const s of f.statuses) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(dotX, by + h / 2, 2.6, 0, Math.PI * 2);
      ctx.fill();
      dotX += 7;
    }

    if (combat.active === f) {
      const ay = by - 15 + Math.sin(this.time / 300) * 2;
      ctx.fillStyle = '#e8c37a';
      ctx.shadowColor = '#e8c37a';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(f.vx - 4, ay - 4);
      ctx.lineTo(f.vx + 4, ay - 4);
      ctx.lineTo(f.vx, ay + 2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // keep team color referenced for ring fallback
    void teamColor;
  }

  private drawEffects(): void {
    const { ctx } = this;

    for (const e of this.effects) {
      const p = e.t / e.life;

      if (e.kind === 'bolt' && e.from && e.to) {
        const a = tilePos(e.from.x, e.from.y);
        const b = tilePos(e.to.x, e.to.y);
        const from = { x: a.x, y: a.y - 28 };
        const to = { x: b.x, y: b.y - 24 };
        const head = {
          x: lerp(from.x, to.x, Math.min(1, p * 2.4)),
          y: lerp(from.y, to.y, Math.min(1, p * 2.4)),
        };
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = 0.35 * (1 - p);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = e.color;
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      if (e.kind === 'slash' && e.at) {
        const p0 = tilePos(e.at.x, e.at.y);
        const cy = p0.y - 22;
        ctx.save();
        ctx.translate(p0.x, cy);
        ctx.rotate(-0.5 + p * 1.1);
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = 1 - p;
        ctx.lineWidth = 3;
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(0, 0, 20 + p * 8, -0.9, 0.9);
        ctx.stroke();
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 13 + p * 6, -0.7, 0.7);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      if (e.kind === 'ring' && e.at) {
        const p0 = tilePos(e.at.x, e.at.y);
        const r = 8 + p * 30;
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.ellipse(p0.x, p0.y - 20, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(p0.x, p0.y - 20, r * 0.65, r * 0.36, 0, 0, Math.PI * 2);
        ctx.stroke();

        if (e.healKind === 'heal') {
          ctx.fillStyle = e.color;
          for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * Math.PI * 2 + this.time;
            const rr = 14 + p * 20;
            const x = p0.x + Math.cos(ang) * rr;
            const y = p0.y - 22 + Math.sin(ang) * rr * 0.5 - p * 12;
            ctx.globalAlpha = (1 - p) * 0.8;
            ctx.fillRect(x - 1, y - 4, 2, 8);
            ctx.fillRect(x - 4, y - 1, 8, 2);
          }
        }
        ctx.globalAlpha = 1;
      }

      if (e.kind === 'teleport' && e.from && e.to) {
        for (const t of [e.from, e.to]) {
          const p0 = tilePos(t.x, t.y);
          const r = 6 + p * 26;
          ctx.strokeStyle = e.color;
          ctx.globalAlpha = 1 - p;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(p0.x, p0.y - 18, r, r * 0.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawFloaters(): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    for (const f of this.floaters) {
      const p = f.t / f.life;
      const y = f.y - p * 30;
      ctx.globalAlpha = 1 - Math.max(0, (p - 0.55) / 0.45);
      ctx.font = '800 15px Inter, system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(4, 8, 14, 0.85)';
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
  }
}
