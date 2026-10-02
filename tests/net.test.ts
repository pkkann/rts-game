import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type GameServer } from '../server/index';
import type { Room } from '../server/room';
import { NetTransport, type StartInfo } from '../src/net/net';
import { HASH_INTERVAL, type SlotInfo } from '../src/net/protocol';
import { applyCommand } from '../src/sim/commands';
import { stateHash } from '../src/sim/hash';
import { stepWorld } from '../src/sim/step';
import { TILE, type World } from '../src/sim/types';
import { createWorld } from '../src/sim/world';

/** A headless client: a NetTransport plus its own copy of the world, run like the game loop does. */
class Client {
  net: NetTransport;
  world: World | null = null;
  info: StartInfo | null = null;
  lobby: SlotInfo[] = [];
  errors: string[] = [];
  desyncs: number[] = [];
  presence: boolean[] = [];

  constructor(url: string) {
    this.net = new NetTransport(url);
    this.net.onLobby = (s) => (this.lobby = s);
    this.net.onStart = (info) => {
      this.info = info;
      this.world = createWorld(info.seed, info.players.length);
    };
    this.net.onError = (m) => this.errors.push(m);
    this.net.onDesync = (t) => this.desyncs.push(t);
    this.net.onPresence = (c) => (this.presence = c);
  }

  /** Run every tick that has arrived. */
  catchUp() {
    const w = this.world!;
    while (this.net.ready(w.tick)) {
      for (const c of this.net.take(w.tick)) applyCommand(w, c.player, c.cmd);
      stepWorld(w);
      if (w.tick % HASH_INTERVAL === 0) this.net.reportHash(w.tick, stateHash(w));
    }
  }
}

async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

let server: GameServer;
let url: string;
const clients: Client[] = [];

function client() {
  const c = new Client(url);
  clients.push(c);
  return c;
}

beforeEach(async () => {
  server = await createServer(0, { manualClock: true });
  url = `ws://localhost:${server.port}/ws`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.net.close();
  await server.close();
});

/** Host + one joined human; slot 2 is an AI. Returns the started room. */
async function startMatch() {
  const a = client();
  a.net.create('Alice');
  await until(() => a.net.slot === 0);
  a.net.setSlot(1, 'open');
  a.net.setSlot(2, 'ai');
  for (let i = 3; i < 10; i++) a.net.setSlot(i, 'closed');
  await until(() => a.lobby[2]?.kind === 'ai' && a.lobby[1]?.kind === 'open');
  const b = client();
  b.net.join(a.net.code, 'Bob');
  await until(() => a.lobby[1]?.kind === 'human');
  a.net.start();
  await until(() => !!a.info && !!b.info);
  const room = server.rooms.get(a.net.code)!;
  return { a, b, room };
}

async function runTicks(room: Room, n: number, ...cs: Client[]) {
  for (let i = 0; i < n; i++) room.tick();
  const target = room.currentTick - 1;
  await until(() => cs.every((c) => c.net.latest >= target));
  for (const c of cs) c.catchUp();
}

describe('game server', () => {
  it('only the host can change slots or start', async () => {
    const a = client();
    a.net.create('Alice');
    await until(() => a.net.slot === 0);
    const b = client();
    b.net.join(a.net.code, 'Bob');
    // Slot 1 starts as AI, so Bob takes slot 2.
    await until(() => b.net.slot === 2 && a.lobby[2]?.name === 'Bob');
    b.net.setSlot(3, 'closed');
    b.net.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.rooms.get(a.net.code)!.phase).toBe('lobby');
    expect(a.lobby[3].kind).toBe('open');
    expect(b.info).toBeNull();
  });

  it('keeps clients in sync with each other and the server', async () => {
    const { a, b, room } = await startMatch();
    expect(a.info!.players.map((p) => p.ai)).toEqual([false, false, true]);
    expect(a.info!.you).toBe(0);
    expect(b.info!.you).toBe(1);

    const mine = [...a.world!.entities.values()].filter((e) => e.owner === 0 && e.kind === 'unit');
    a.net.send(0, { t: 'move', ids: mine.map((e) => e.id), x: 20, y: 20 });
    a.net.send(0, { t: 'build', item: 'power' });
    await until(() => room['pending'].length === 2);
    await runTicks(room, 450, a, b);

    expect(stateHash(a.world!)).toBe(room.serverHash);
    expect(stateHash(b.world!)).toBe(room.serverHash);
    // The server AI did something.
    expect(room['log'].some(([, cmds]) => cmds.some((c) => c.player === 2))).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(a.desyncs).toEqual([]);
    expect(b.desyncs).toEqual([]);
  });

  it("ignores commands for another player's units", async () => {
    const { a, b, room } = await startMatch();
    const alices = [...a.world!.entities.values()].filter((e) => e.owner === 0 && e.kind === 'unit');
    const before = alices.map((e) => [e.x, e.y]);
    b.net.send(1, { t: 'move', ids: alices.map((e) => e.id), x: 30, y: 30 });
    // Malformed commands are dropped by the server.
    b.net.send(1, { t: 'move', ids: 'nope', x: 1, y: 1 } as never);
    await runTicks(room, 60, a, b);
    for (const [k, e] of alices.entries()) expect([e.x, e.y]).toEqual(before[k]);
    expect(room['log'].every(([, cmds]) => cmds.every((c) => c.player !== 1 || Array.isArray((c.cmd as { ids?: unknown }).ids)))).toBe(true);
  });

  it('keeps going without a disconnected player, who can rejoin and catch up', async () => {
    const { a, b, room } = await startMatch();
    await runTicks(room, 100, a, b);
    const token = b.net.token;
    const code = b.net.code;
    b.net.close();
    await until(() => a.presence[1] === false);
    expect(room.phase).toBe('running');

    // Alice attacks Bob's base while he's away.
    const alices = [...a.world!.entities.values()].filter((e) => e.owner === 0 && e.kind === 'unit');
    const bobYard = [...a.world!.entities.values()].find((e) => e.owner === 1 && e.type === 'cy')!;
    a.net.send(0, { t: 'attackMove', ids: alices.map((e) => e.id), x: Math.floor(bobYard.x / TILE), y: Math.floor(bobYard.y / TILE) });
    await until(() => room['pending'].length >= 1);
    await runTicks(room, 600, a);
    expect(a.world!.tick).toBe(room.currentTick);

    const b2 = client();
    b2.net.rejoin(code, token);
    await until(() => !!b2.info);
    expect(b2.info!.you).toBe(1);
    expect(b2.info!.tick).toBe(room.currentTick);
    b2.catchUp();
    expect(b2.world!.tick).toBe(room.currentTick);
    expect(stateHash(b2.world!)).toBe(stateHash(a.world!));
    await until(() => a.presence[1] === true);

    // And they stay in sync afterwards.
    await runTicks(room, 100, a, b2);
    expect(stateHash(b2.world!)).toBe(room.serverHash);
  });

  it('rejects a bad rejoin token', async () => {
    const { a } = await startMatch();
    const c = client();
    c.net.rejoin(a.net.code, 'not-a-token');
    await until(() => c.errors.length > 0);
    expect(c.info).toBeNull();
  });

  it('refuses new joins once the match has started', async () => {
    const { a } = await startMatch();
    const c = client();
    c.net.join(a.net.code, 'Late');
    await until(() => c.errors.length > 0);
    expect(c.errors[0]).toMatch(/started/);
  });
});
