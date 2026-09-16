/** Optional canvas decoration; it never owns tile visibility or game state. */
export function startTurnSparkles(
  canvas: HTMLCanvasElement,
  tiles: readonly HTMLElement[],
  scoreBadge?: HTMLElement,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { land: () => {}, stop: () => {} };
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.scale(ratio, ratio);
  type Point = { x: number; y: number; time: number };
  type Spark = Point & { vx: number; vy: number; life: number; size: number };
  const followers = scoreBadge ? [...tiles, scoreBadge] : tiles;
  const paths: Point[][] = followers.map(() => []);
  const trailLife = 700;
  let sparks: Spark[] = [];
  let frame = 0;
  let stopped = false;
  let serial = 0;
  function emit(x: number, y: number, time: number, burst = false) {
    // A bounded, deterministic scatter keeps the trail stable between frames.
    const phase = ++serial * 2.399963;
    const speed = burst ? 28 + (serial % 5) * 11 : 5 + (serial % 7) * 3;
    sparks.push({
      x,
      y,
      time,
      vx: Math.cos(phase) * speed,
      vy: Math.sin(phase) * speed - (burst ? 10 : 0),
      life: burst ? 800 : 560 + (serial % 4) * 60,
      size: burst ? 2.3 + (serial % 3) : 1 + (serial % 5) * 0.65,
    });
    if (sparks.length > 220) sparks.shift();
  }
  function draw(now: number) {
    if (stopped) return;
    ctx!.clearRect(0, 0, width, height);
    // Read only the composited tile positions, with no layout writes per frame.
    const positions = followers.map((tile) => {
      if (tile.style.visibility !== "visible") return null;
      const rect = tile.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    positions.forEach((point, i) => {
      const path = paths[i];
      if (point) {
        const last = path.at(-1);
        if (
          !last ||
          (now - last.time >= 28 &&
            Math.hypot(point.x - last.x, point.y - last.y) > 1)
        ) {
          path.push({ ...point, time: now });
          emit(point.x, point.y, now);
          emit(point.x, point.y, now);
        }
      }
      while (path.length && now - path[0].time > trailLife) path.shift();
      if (path.length < 2) return;
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      // A soft gold ribbon under a white-hot core; both follow the actual tiles.
      // One joined glow path avoids repeating an expensive blur per segment.
      ctx!.globalAlpha = 0.5;
      ctx!.strokeStyle = "#efb343";
      ctx!.lineWidth = 3.2;
      ctx!.shadowColor = "#ffc954";
      ctx!.shadowBlur = 10;
      ctx!.beginPath();
      ctx!.moveTo(path[0].x, path[0].y);
      for (let p = 1; p < path.length; p++) ctx!.lineTo(path[p].x, path[p].y);
      ctx!.stroke();
      ctx!.shadowBlur = 0;
      for (let p = 1; p < path.length; p++) {
        const age = (now - path[p - 1].time) / trailLife;
        ctx!.globalAlpha = (1 - age) * 0.95;
        ctx!.strokeStyle = "#fff9d6";
        ctx!.lineWidth = 1.35;
        ctx!.beginPath();
        ctx!.moveTo(path[p - 1].x, path[p - 1].y);
        ctx!.lineTo(path[p].x, path[p].y);
        ctx!.stroke();
      }
    });
    sparks = sparks.filter((spark) => now - spark.time < spark.life);
    for (const spark of sparks) {
      const age = (now - spark.time) / spark.life;
      const seconds = (now - spark.time) / 1000;
      const x = spark.x + spark.vx * seconds;
      const y = spark.y + spark.vy * seconds + 10 * seconds * seconds;
      const radius = spark.size * (1 - age * 0.55);
      ctx!.globalAlpha = Math.sin(Math.PI * age) * 0.9;
      ctx!.shadowBlur = 10;
      ctx!.shadowColor = "#edb832";
      ctx!.fillStyle = "#fff9d9";
      ctx!.beginPath();
      // Four-point stars interspersed with fine golden dust.
      if (spark.size >= 2) {
        ctx!.moveTo(x, y - radius * 2);
        ctx!.lineTo(x + radius * 0.35, y - radius * 0.35);
        ctx!.lineTo(x + radius * 2, y);
        ctx!.lineTo(x + radius * 0.35, y + radius * 0.35);
        ctx!.lineTo(x, y + radius * 2);
        ctx!.lineTo(x - radius * 0.35, y + radius * 0.35);
        ctx!.lineTo(x - radius * 2, y);
        ctx!.lineTo(x - radius * 0.35, y - radius * 0.35);
        ctx!.closePath();
      } else ctx!.arc(x, y, radius, 0, Math.PI * 2);
      ctx!.fill();
    }
    ctx!.globalAlpha = 1;
    ctx!.shadowBlur = 0;
    frame = requestAnimationFrame(draw);
  }
  frame = requestAnimationFrame(draw);
  return {
    land(rect: { left: number; top: number; width: number; height: number }) {
      if (stopped) return;
      const now = performance.now();
      for (let i = 0; i < 16; i++)
        emit(rect.left + rect.width / 2, rect.top + rect.height / 2, now, true);
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, width, height);
    },
  };
}
