import type { Command, PlayerCommand } from '../sim/types';
import type { CommandTransport } from './transport';

/** Delay in ticks between issuing and executing a command, as lockstep would. */
export const INPUT_DELAY = 2;

export class LocalTransport implements CommandTransport {
  private pending = new Map<number, { cmd: PlayerCommand; seq: number }[]>();
  private seq = 0;
  /** The tick the sim will execute next. Kept up to date by the game loop. */
  currentTick = 0;

  send(player: number, cmd: Command): void {
    const tick = this.currentTick + INPUT_DELAY;
    let list = this.pending.get(tick);
    if (!list) this.pending.set(tick, (list = []));
    // Deep copy so later mutation by the caller cannot affect the sim.
    list.push({ cmd: { player, cmd: structuredClone(cmd) }, seq: this.seq++ });
  }

  take(tick: number): PlayerCommand[] {
    const list = this.pending.get(tick) ?? [];
    this.pending.delete(tick);
    list.sort((a, b) => a.cmd.player - b.cmd.player || a.seq - b.seq);
    return list.map((c) => c.cmd);
  }

  ready(_tick: number): boolean {
    return true;
  }
}
