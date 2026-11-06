import type { Tile } from './types';

export const GRID = 14;
export const TILE_W = 64;
export const TILE_H = 32;

/** World-space origin of the isometric diamond. */
export const WORLD_W = 960;
export const WORLD_H = 560;
export const ORIGIN_X = 480;
export const ORIGIN_Y = 90;

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const key = (x: number, y: number): string => `${x},${y}`;

export const parseKey = (k: string): Tile => {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
};

export const inBounds = (x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < GRID && y < GRID;

/** Manhattan distance on the tactical grid. */
export const manhattan = (a: Tile, b: Tile): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function tilePos(x: number, y: number): { x: number; y: number } {
  return {
    x: ORIGIN_X + ((x - y) * TILE_W) / 2,
    y: ORIGIN_Y + ((x + y) * TILE_H) / 2,
  };
}

export function screenToTile(
  sx: number,
  sy: number,
  offX: number,
  offY: number,
  scale: number,
): Tile | null {
  const wx = (sx - offX) / scale;
  const wy = (sy - offY) / scale;
  const u = (wx - ORIGIN_X) / (TILE_W / 2);
  const v = (wy - ORIGIN_Y) / (TILE_H / 2);
  const x = Math.round((u + v) / 2);
  const y = Math.round((v - u) / 2);
  if (!inBounds(x, y)) return null;
  return { x, y };
}

/** Bresenham line of sight, blocked by obstacles (not by fighters). */
export function hasLineOfSight(
  obstacles: Set<string>,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  let x0 = ax;
  let y0 = ay;
  const dx = Math.abs(bx - x0);
  const sx = x0 < bx ? 1 : -1;
  const dy = -Math.abs(by - y0);
  const sy = y0 < by ? 1 : -1;
  let err = dx + dy;

  for (let guard = 0; guard < 64; guard++) {
    if (x0 === bx && y0 === by) return true;
    if (!(x0 === ax && y0 === ay) && obstacles.has(key(x0, y0))) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return false;
}
