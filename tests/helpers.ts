import { AIController } from '../src/ai/ai';
import { LocalTransport } from '../src/net/local';
import { applyCommand } from '../src/sim/commands';
import { stepWorld } from '../src/sim/step';
import { createWorld } from '../src/sim/world';

/** A headless match between AIs. */
export function aiMatch(seed: number, players = 2) {
  const world = createWorld(seed, players);
  const transport = new LocalTransport();
  const ais = world.players.map((p) => new AIController(p.id, transport));
  const step = () => {
    transport.currentTick = world.tick;
    for (const ai of ais) ai.update(world);
    for (const c of transport.take(world.tick)) applyCommand(world, c.player, c.cmd);
    stepWorld(world);
  };
  return { world, transport, step };
}
