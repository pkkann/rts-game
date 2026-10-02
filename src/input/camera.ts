const PAN_SPEED = 900; // px per second

export class Camera {
  x = 0;
  y = 0;
  viewW = 800;
  viewH = 600;

  constructor(
    private mapW: number,
    private mapH: number,
  ) {}

  resize(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
    this.clamp();
  }

  centerOn(px: number, py: number) {
    this.x = px - this.viewW / 2;
    this.y = py - this.viewH / 2;
    this.clamp();
  }

  pan(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  /**
   * Keyboard scrolling with arrows or WASD (`keys` holds KeyboardEvent.code
   * values). The minimap is the only other way to move the view.
   */
  update(dtMs: number, keys: Set<string>) {
    let dx = 0;
    let dy = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) dx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) dx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) dy -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) dy += 1;
    if (dx || dy) this.pan((dx * PAN_SPEED * dtMs) / 1000, (dy * PAN_SPEED * dtMs) / 1000);
  }

  private clamp() {
    this.x = Math.max(0, Math.min(this.x, Math.max(0, this.mapW - this.viewW)));
    this.y = Math.max(0, Math.min(this.y, Math.max(0, this.mapH - this.viewH)));
  }
}
