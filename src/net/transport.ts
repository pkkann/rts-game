import type { Command, PlayerCommand } from '../sim/types';

/**
 * Where commands go between input and simulation. Single player uses a
 * local implementation; a lockstep network transport can implement the
 * same interface later (send to peers, deliver once all players' input
 * for a tick has arrived).
 */
export interface CommandTransport {
  /** Queue a command from `player`, to be executed at a future tick. */
  send(player: number, cmd: Command): void;
  /** Commands for `tick`, in a deterministic order. Called once per tick. */
  take(tick: number): PlayerCommand[];
  /** Whether the sim may advance to `tick` (network transports may need to wait). */
  ready(tick: number): boolean;
}
