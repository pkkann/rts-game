import { TILE, type World } from './types';

const STRAIGHT = 10;
const DIAG = 14;

// Reused buffers; a generation counter avoids clearing them every search.
let cap = 0;
let gScore = new Int32Array(0);
let parent = new Int32Array(0);
let seen = new Uint32Array(0);
let closed = new Uint32Array(0);
let generation = 0;

function ensure(n: number) {
  if (cap >= n) return;
  cap = n;
  gScore = new Int32Array(n);
  parent = new Int32Array(n);
  seen = new Uint32Array(n);
  closed = new Uint32Array(n);
  generation = 0;
}

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return STRAIGHT * Math.max(dx, dy) + (DIAG - STRAIGHT) * Math.min(dx, dy);
}

/** Binary min-heap of node indices keyed by (f, h, index) for deterministic ties. */
class Heap {
  nodes: number[] = [];
  f: number[] = [];
  h: number[] = [];
  push(node: number, f: number, h: number) {
    const { nodes, f: fs, h: hs } = this;
    let i = nodes.length;
    nodes.push(node);
    fs.push(f);
    hs.push(h);
    // Sift up by moving the hole, not swapping.
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(f, h, node, fs[p], hs[p], nodes[p])) break;
      nodes[i] = nodes[p];
      fs[i] = fs[p];
      hs[i] = hs[p];
      i = p;
    }
    nodes[i] = node;
    fs[i] = f;
    hs[i] = h;
  }
  pop(): number {
    const { nodes, f: fs, h: hs } = this;
    const top = nodes[0];
    const node = nodes.pop()!;
    const f = fs.pop()!;
    const h = hs.pop()!;
    const n = nodes.length;
    if (n === 0) return top;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= n) break;
      const r = l + 1;
      const m = r < n && less(fs[r], hs[r], nodes[r], fs[l], hs[l], nodes[l]) ? r : l;
      if (!less(fs[m], hs[m], nodes[m], f, h, node)) break;
      nodes[i] = nodes[m];
      fs[i] = fs[m];
      hs[i] = hs[m];
      i = m;
    }
    nodes[i] = node;
    fs[i] = f;
    hs[i] = h;
    return top;
  }
  get size() {
    return this.nodes.length;
  }
}

function less(fa: number, ha: number, na: number, fb: number, hb: number, nb: number): boolean {
  if (fa !== fb) return fa < fb;
  if (ha !== hb) return ha < hb;
  return na < nb;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * A* on the tile grid, 8-directional without corner cutting.
 * Returns tile indices from the first step to the goal (start excluded).
 * If the goal is blocked or unreachable, returns a path to the closest reachable tile.
 */
export function findPath(world: World, start: number, goal: number): number[] {
  const { w, h, blocked } = world;
  ensure(w * h);
  generation++;
  if (start === goal) return [];

  const sx = start % w;
  const sy = (start / w) | 0;
  // A blocked goal (usually a building being attacked) would make A* flood the
  // whole map looking for it. Aim for the nearest open tile around it instead.
  if (blocked[goal]) goal = nearestOpen(world, goal, sx, sy);
  if (start === goal) return [];
  const gx = goal % w;
  const gy = (goal / w) | 0;
  const heap = new Heap();
  gScore[start] = 0;
  parent[start] = -1;
  seen[start] = generation;
  const h0 = octile(sx, sy, gx, gy);
  heap.push(start, h0, h0);

  let best = start;
  let bestH = h0;

  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur] === generation) continue;
    closed[cur] = generation;
    if (cur === goal) {
      best = cur;
      break;
    }
    const cx = cur % w;
    const cy = (cur / w) | 0;
    const ch = octile(cx, cy, gx, gy);
    if (ch < bestH) {
      bestH = ch;
      best = cur;
    }
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (blocked[ni] || closed[ni] === generation) continue;
      const diag = dx !== 0 && dy !== 0;
      if (diag && (blocked[cy * w + nx] || blocked[ny * w + cx])) continue;
      const g = gScore[cur] + (diag ? DIAG : STRAIGHT);
      if (seen[ni] === generation && g >= gScore[ni]) continue;
      seen[ni] = generation;
      gScore[ni] = g;
      parent[ni] = cur;
      const hh = octile(nx, ny, gx, gy);
      heap.push(ni, g + hh, hh);
    }
  }

  const path: number[] = [];
  for (let n = best; n !== start && n !== -1; n = parent[n]) path.push(n);
  path.reverse();
  return smooth(world, start, path);
}

/**
 * The open tile closest to `goal` (by ring), preferring the one nearest the start.
 * Returns `goal` itself if nothing within a few tiles is open.
 */
function nearestOpen(world: World, goal: number, sx: number, sy: number): number {
  const { w, h, blocked } = world;
  const gx = goal % w;
  const gy = (goal / w) | 0;
  for (let r = 1; r <= 6; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let y = gy - r; y <= gy + r; y++) {
      for (let x = gx - r; x <= gx + r; x++) {
        if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) !== r) continue;
        if (x < 0 || y < 0 || x >= w || y >= h || blocked[y * w + x]) continue;
        const d = octile(x, y, sx, sy);
        if (d < bestD) {
          bestD = d;
          best = y * w + x;
        }
      }
    }
    if (best >= 0) return best;
  }
  return goal;
}

/** Drop intermediate waypoints that have a clear straight line between them. */
function smooth(world: World, start: number, path: number[]): number[] {
  if (path.length < 3) return path;
  const out: number[] = [];
  let anchor = start;
  for (let i = 1; i < path.length; i++) {
    if (!clearLine(world, anchor, path[i])) {
      out.push(path[i - 1]);
      anchor = path[i - 1];
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Conservative line-of-travel check: samples the center line and two offset lines. */
export function clearLine(world: World, a: number, b: number): boolean {
  const { w } = world;
  const x0 = (a % w) * TILE + TILE / 2;
  const y0 = ((a / w) | 0) * TILE + TILE / 2;
  const x1 = (b % w) * TILE + TILE / 2;
  const y1 = ((b / w) | 0) * TILE + TILE / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return true;
  const ox = Math.trunc((-dy * 100) / len);
  const oy = Math.trunc((dx * 100) / len);
  const steps = Math.ceil(len / 32);
  for (let s = 0; s <= steps; s++) {
    const px = x0 + Math.trunc((dx * s) / steps);
    const py = y0 + Math.trunc((dy * s) / steps);
    if (blockedAt(world, px, py) || blockedAt(world, px + ox, py + oy) || blockedAt(world, px - ox, py - oy)) {
      return false;
    }
  }
  return true;
}

function blockedAt(world: World, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return true;
  return world.blocked[ty * world.w + tx] === 1;
}

/**
 * Breadth-first search over passable tiles from `start`, returning the first
 * tile for which `accept` is true (or -1). Deterministic neighbour order.
 */
export function bfsFind(world: World, start: number, accept: (i: number) => boolean, maxNodes = 4096): number {
  const { w, h, blocked } = world;
  ensure(w * h);
  generation++;
  const queue = [start];
  seen[start] = generation;
  for (let qi = 0; qi < queue.length && qi < maxNodes; qi++) {
    const cur = queue[qi];
    if (accept(cur)) return cur;
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] === generation || blocked[ni]) continue;
      // Same no-corner-cutting rule as findPath, so whatever we find is reachable.
      if (dx !== 0 && dy !== 0 && (blocked[cy * w + nx] || blocked[ny * w + cx])) continue;
      seen[ni] = generation;
      queue.push(ni);
    }
  }
  return -1;
}
