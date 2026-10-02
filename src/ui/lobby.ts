import { NetTransport, type StartInfo } from '../net/net';
import type { SlotInfo, SlotSetting } from '../net/protocol';
import { TEAM } from '../render/palette';
import { MAX_PLAYERS } from '../sim/map';

export interface LobbyHooks {
  playLocal(seed: number, ais: number): void;
  playOnline(net: NetTransport, info: StartInfo): void;
}

const NAME_KEY = 'rts-name';
const tokenKey = (code: string) => `rts-token-${code}`;

/** Web storage can throw (private mode, blocked storage); none of this is essential. */
function storage(kind: 'local' | 'session') {
  const get = () => (kind === 'local' ? localStorage : sessionStorage);
  return {
    get(key: string): string | null {
      try {
        return get().getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string) {
      try {
        get().setItem(key, value);
      } catch {
        /* ignore */
      }
    },
    remove(key: string) {
      try {
        get().removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

const store = storage('local');
const session = storage('session');

/**
 * Rejoin tokens live in sessionStorage (so two tabs in one browser keep
 * separate seats) and in localStorage (so closing the tab and opening the
 * link again still finds the seat).
 */
const tokens = {
  get: (code: string) => session.get(tokenKey(code)) ?? store.get(tokenKey(code)),
  set(code: string, token: string) {
    session.set(tokenKey(code), token);
    store.set(tokenKey(code), token);
  },
  remove(code: string) {
    session.remove(tokenKey(code));
    store.remove(tokenKey(code));
  },
};

function serverUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function setRoomInUrl(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

/** Start menu: offline skirmish, or host / join an online game and wait in its lobby. */
export class Lobby {
  readonly el = document.createElement('div');
  private net: NetTransport | null = null;
  private slots: SlotInfo[] = [];

  constructor(private hooks: LobbyHooks) {
    this.el.id = 'lobby';
  }

  /** Show the menu, or go straight back into a game this browser has a seat in. */
  open() {
    this.el.hidden = false;
    const code = new URL(location.href).searchParams.get('room')?.toUpperCase() ?? '';
    const token = code ? tokens.get(code) : null;
    if (code && token) {
      this.renderMessage(`Rejoining game ${code}…`);
      this.connect().rejoin(code, token);
    } else this.renderMenu(code);
  }

  hide() {
    this.el.hidden = true;
  }

  /** After an online game: forget the seat and show the menu. */
  leave() {
    if (this.net?.code) tokens.remove(this.net.code);
    this.net?.close();
    this.net = null;
    setRoomInUrl(null);
    this.el.hidden = false;
    this.renderMenu('');
  }

  private connect(): NetTransport {
    this.net?.close();
    const net = new NetTransport(serverUrl());
    this.net = net;
    net.onJoined = (code, _slot, token) => {
      tokens.set(code, token);
      setRoomInUrl(code);
    };
    net.onLobby = (slots) => {
      this.slots = slots;
      this.renderRoom();
    };
    net.onStart = (info) => {
      this.hide();
      this.hooks.playOnline(net, info);
    };
    net.onError = (msg) => {
      // Our seat is gone (or never existed): drop the stale token and start over.
      if (net.code) tokens.remove(net.code);
      const code = net.code;
      net.close();
      this.net = null;
      setRoomInUrl(null);
      this.renderMenu(code, msg);
    };
    net.onConnection = (lost) => {
      if (lost && !this.el.hidden) this.renderMessage('Connection lost — reconnecting…');
    };
    return net;
  }

  private renderMenu(code: string, error = '') {
    const box = this.box();
    const name = input('Your name', store.get(NAME_KEY) ?? '');
    name.maxLength = 20;
    name.addEventListener('change', () => store.set(NAME_KEY, name.value.trim()));

    const ais = document.createElement('select');
    for (let n = 1; n < MAX_PLAYERS; n++) ais.append(new Option(`${n} AI opponent${n > 1 ? 's' : ''}`, String(n)));
    const playLocal = button('Play offline', () => {
      this.hide();
      this.hooks.playLocal((Math.random() * 2 ** 31) | 0, Number(ais.value));
    });

    const host = button('Host online game', () => {
      store.set(NAME_KEY, name.value.trim());
      this.renderMessage('Creating game…');
      this.connect().create(name.value);
    });
    const codeIn = input('Code', code);
    codeIn.maxLength = 4;
    codeIn.className = 'code-input';
    codeIn.addEventListener('input', () => (codeIn.value = codeIn.value.toUpperCase()));
    const join = button('Join', () => {
      const c = codeIn.value.trim().toUpperCase();
      if (!c) return codeIn.focus();
      store.set(NAME_KEY, name.value.trim());
      this.renderMessage(`Joining ${c}…`);
      this.connect().join(c, name.value);
    });
    codeIn.addEventListener('keydown', (ev) => ev.key === 'Enter' && join.click());

    box.append(
      h('h1', 'Shape RTS'),
      row(label('Name'), name),
      h('h2', 'Skirmish'),
      row(ais, playLocal),
      h('h2', 'Online'),
      row(host),
      row(codeIn, join),
    );
    if (error) box.append(p(error, 'error'));
    if (code) codeIn.focus();
  }

  private renderMessage(text: string) {
    const box = this.box();
    box.append(h('h1', 'Shape RTS'), p(text));
    box.append(row(button('Cancel', () => this.leave(), 'secondary')));
  }

  private renderRoom() {
    const net = this.net!;
    const isHost = net.slot === 0;
    const box = this.box();
    const link = new URL(location.href);
    link.search = `?room=${net.code}`;
    const copy = button('Copy invite link', () => {
      navigator.clipboard?.writeText(link.href).then(
        () => (copy.textContent = 'Copied!'),
        () => (copy.textContent = link.href),
      );
    }, 'secondary');
    box.append(h('h1', 'Game lobby'), row(label('Code'), h('span', net.code, 'room-code'), copy));

    const list = document.createElement('div');
    list.className = 'slots';
    this.slots.forEach((s, i) => {
      const r = document.createElement('div');
      r.className = `slot ${s.kind}`;
      const swatch = document.createElement('i');
      swatch.style.background = TEAM[i].css;
      r.append(swatch);
      if (s.kind === 'human') {
        const you = i === net.slot ? ' (you)' : '';
        const host = i === 0 ? ' · host' : '';
        r.append(h('span', `${s.name}${you}${host}${s.connected ? '' : ' · away'}`));
        if (isHost && i !== 0) r.append(button('Remove', () => this.setSlot(i, 'open'), 'secondary small'));
      } else if (isHost) {
        const sel = document.createElement('select');
        for (const [v, t] of [['open', 'Open'], ['ai', 'AI'], ['closed', 'Closed']] as const) sel.append(new Option(t, v, false, s.kind === v));
        sel.addEventListener('change', () => this.setSlot(i, sel.value as SlotSetting));
        r.append(sel);
      } else {
        r.append(h('span', s.kind === 'ai' ? 'AI' : s.kind === 'open' ? 'Open' : 'Closed'));
      }
      list.append(r);
    });
    box.append(list);

    const count = this.slots.filter((s) => s.kind === 'human' || s.kind === 'ai').length;
    const actions = row();
    if (isHost) {
      const start = button(`Start (${count} players)`, () => net.start());
      start.disabled = count < 2;
      actions.append(start);
    } else actions.append(p('Waiting for the host to start…'));
    actions.append(button('Leave', () => this.leave(), 'secondary'));
    box.append(actions, p('Open slots that nobody has joined are left out when the game starts.', 'hint'));
  }

  private setSlot(i: number, kind: SlotSetting) {
    this.net?.setSlot(i, kind);
  }

  private box(): HTMLDivElement {
    this.el.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'lobby-box';
    this.el.append(box);
    return box;
  }
}

function h(tag: string, text: string, cls = '') {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function p(text: string, cls = '') {
  return h('p', text, cls);
}

function label(text: string) {
  return h('label', text);
}

function input(placeholder: string, value: string) {
  const e = document.createElement('input');
  e.placeholder = placeholder;
  e.value = value;
  e.spellcheck = false;
  return e;
}

function button(text: string, onClick: () => void, cls = '') {
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

function row(...children: HTMLElement[]) {
  const d = document.createElement('div');
  d.className = 'row';
  d.append(...children);
  return d;
}
