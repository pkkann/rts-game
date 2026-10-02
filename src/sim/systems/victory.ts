import type { World } from '../types';

export function updateVictory(world: World): void {
  if (world.winner >= 0 || world.tick % 10 !== 0) return;
  const hasBuildings = new Set<number>();
  for (const e of world.entities.values()) if (e.kind === 'building') hasBuildings.add(e.owner);
  for (const p of world.players) if (!hasBuildings.has(p.id)) p.defeated = true;
  const alive = world.players.filter((p) => !p.defeated);
  if (alive.length <= 1) world.winner = alive.length === 1 ? alive[0].id : world.players.length;
}
