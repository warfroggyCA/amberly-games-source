interface Point {
  x: number;
  y: number;
}
export interface DragBounds extends Point {
  width: number;
  height: number;
}
export interface DragTransform extends Point {
  scale: number;
}
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function constrain(
  board: DragBounds,
  viewport: DragBounds,
  transform: DragTransform,
): DragTransform {
  return {
    scale: transform.scale,
    x: clamp(
      transform.x,
      viewport.x + viewport.width - board.x - board.width * transform.scale,
      viewport.x - board.x,
    ),
    y: clamp(
      transform.y,
      viewport.y + viewport.height - board.y - board.height * transform.scale,
      viewport.y - board.y,
    ),
  };
}

/** Keep the aimed-at board point in place as the board grows, including at its edges. */
export function zoomDragBoard(
  board: DragBounds,
  viewport: DragBounds,
  anchor: Point,
  scale: number,
): DragTransform {
  return constrain(board, viewport, {
    scale,
    x: (anchor.x - board.x) * (1 - scale),
    y: (anchor.y - board.y) * (1 - scale),
  });
}

export function insideDragViewport(point: Point, viewport: DragBounds) {
  return (
    point.x >= viewport.x &&
    point.x <= viewport.x + viewport.width &&
    point.y >= viewport.y &&
    point.y <= viewport.y + viewport.height
  );
}

/** Pan only in the edge band, at a bounded speed independent of frame rate. */
export function panDragBoard(
  board: DragBounds,
  viewport: DragBounds,
  transform: DragTransform,
  aim: Point,
  elapsedSeconds: number,
): DragTransform {
  if (!insideDragViewport(aim, viewport)) return transform;
  const velocity = (position: number, size: number) => {
    const band = Math.min(48, size / 4);
    if (position < band) return (1 - position / band) * 260;
    if (position > size - band) return -((position - size + band) / band) * 260;
    return 0;
  };
  // Do not jump across the board after a delayed/backgrounded animation frame.
  const seconds = clamp(elapsedSeconds, 0, 0.04);
  return constrain(board, viewport, {
    scale: transform.scale,
    x: transform.x + velocity(aim.x - viewport.x, viewport.width) * seconds,
    y: transform.y + velocity(aim.y - viewport.y, viewport.height) * seconds,
  });
}

function visibleBounds(board: DOMRect, viewport: DOMRect): DragBounds {
  const screen = window.visualViewport;
  const x = Math.max(board.left, viewport.left, screen?.offsetLeft ?? 0);
  const y = Math.max(board.top, viewport.top, screen?.offsetTop ?? 0);
  const right = Math.min(
    board.right,
    viewport.right,
    (screen?.offsetLeft ?? 0) + (screen?.width ?? window.innerWidth),
  );
  const bottom = Math.min(
    board.bottom,
    viewport.bottom,
    (screen?.offsetTop ?? 0) + (screen?.height ?? window.innerHeight),
  );
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

/** Presentation only: the rendered board remains the single hit-test/placement surface. */
export class GymDragViewport {
  private readonly bounds: DragBounds;
  private readonly viewport: DragBounds;
  private readonly anchor: Point;
  private readonly savedTransform: string;
  private readonly savedHeight: string;
  private readonly scroll: Point;
  private transform: DragTransform;
  private aim: Point;
  private frame = 0;
  private lastTime = 0;
  private startedAt = 0;
  private panArmed = false;
  private active = true;
  private restored = false;
  private restoreAnimation: Animation | null = null;

  static start(
    board: HTMLElement,
    aim: Point,
    reducedMotion: boolean,
    onFrame: () => void,
  ): GymDragViewport | null {
    const scroller = board.parentElement;
    if (!scroller) return null;
    const bounds = board.getBoundingClientRect();
    const viewport = visibleBounds(bounds, scroller.getBoundingClientRect());
    if (
      bounds.width >= 600 ||
      bounds.width <= 0 ||
      viewport.width <= 0 ||
      viewport.height <= 0 ||
      !insideDragViewport(aim, viewport)
    )
      return null;
    return new GymDragViewport(
      board,
      scroller,
      bounds,
      viewport,
      aim,
      reducedMotion,
      onFrame,
    );
  }

  private constructor(
    private readonly board: HTMLElement,
    private readonly scroller: HTMLElement,
    bounds: DOMRect,
    viewport: DragBounds,
    aim: Point,
    private readonly reducedMotion: boolean,
    private readonly onFrame: () => void,
  ) {
    this.bounds = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
    this.viewport = viewport;
    this.anchor = aim;
    this.aim = aim;
    this.savedTransform = board.style.transform;
    this.savedHeight = scroller.style.height;
    this.scroll = { x: scroller.scrollLeft, y: scroller.scrollTop };
    // Hide zoom overflow without moving the rack or changing the page's scroll position.
    scroller.style.height = `${scroller.getBoundingClientRect().height}px`;
    scroller.dataset.gymDragZoom = "active";
    this.transform = zoomDragBoard(
      this.bounds,
      viewport,
      aim,
      reducedMotion ? 2 : 1,
    );
    this.render();
    this.frame = requestAnimationFrame(this.tick);
  }

  move(aim: Point) {
    this.aim = aim;
    if (Math.hypot(aim.x - this.anchor.x, aim.y - this.anchor.y) >= 6)
      this.panArmed = true;
  }

  private render() {
    const { x, y, scale } = this.transform;
    this.board.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  private tick = (time: number) => {
    if (!this.active) return;
    if (!this.startedAt) this.startedAt = time;
    const progress = this.reducedMotion
      ? 1
      : Math.min(1, (time - this.startedAt) / 180);
    if (this.transform.scale < 2)
      this.transform = zoomDragBoard(
        this.bounds,
        this.viewport,
        this.anchor,
        2 - (1 - progress) ** 3,
      );
    if (progress === 1 && this.panArmed)
      this.transform = panDragBoard(
        this.bounds,
        this.viewport,
        this.transform,
        this.aim,
        this.lastTime ? (time - this.lastTime) / 1000 : 0,
      );
    this.lastTime = time;
    this.render();
    // CSS transform and preview use the same rendered frame, even while edge-panning.
    this.onFrame();
    this.frame = requestAnimationFrame(this.tick);
  };

  stop(animate = false) {
    this.active = false;
    cancelAnimationFrame(this.frame);
    this.restoreAnimation?.cancel();
    this.restoreAnimation = null;
    if (this.restored) return;
    const transform = this.board.style.transform;
    this.board.style.transform = this.savedTransform;
    const restore = () => {
      this.restored = true;
      delete this.scroller.dataset.gymDragZoom;
      this.scroller.style.height = this.savedHeight;
      this.scroller.scrollLeft = this.scroll.x;
      this.scroller.scrollTop = this.scroll.y;
    };
    if (animate && !this.reducedMotion && this.board.isConnected) {
      this.scroller.dataset.gymDragZoom = "restoring";
      this.restoreAnimation = this.board.animate(
        [{ transform }, { transform: this.savedTransform || "none" }],
        { duration: 150, easing: "ease-out" },
      );
      this.restoreAnimation.onfinish = restore;
    } else restore();
  }
}
