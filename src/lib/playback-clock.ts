/** Virtual elapsed time shared by replay delays, animations and decoration. */
export class PlaybackClock {
  private elapsed = 0;
  private anchor = performance.now();
  private stopped = false;
  private waits = new Set<{
    target: number;
    timer?: ReturnType<typeof setTimeout>;
    resolve: () => void;
    reject: (reason: Error) => void;
  }>();
  private animations = new Set<Animation>();

  constructor(private rate = 1) {}

  now = () => this.elapsed + (performance.now() - this.anchor) * this.rate;

  setRate(rate: number) {
    if (this.stopped || !Number.isFinite(rate) || rate <= 0) return;
    this.elapsed = this.now();
    this.anchor = performance.now();
    this.rate = rate;
    for (const wait of this.waits) this.arm(wait);
    for (const animation of this.animations) animation.updatePlaybackRate(rate);
  }

  private arm(wait: {
    target: number;
    timer?: ReturnType<typeof setTimeout>;
    resolve: () => void;
  }) {
    clearTimeout(wait.timer);
    wait.timer = setTimeout(
      wait.resolve,
      Math.max(0, wait.target - this.now()) / this.rate,
    );
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped) {
        reject(new DOMException("Cancelled", "AbortError"));
        return;
      }
      const wait = {
        target: this.now() + ms,
        resolve: () => {
          this.waits.delete(wait);
          resolve();
        },
        reject,
      };
      this.waits.add(wait);
      this.arm(wait);
    });
  }

  track(animation: Animation) {
    animation.updatePlaybackRate(this.rate);
    this.animations.add(animation);
    return () => this.animations.delete(animation);
  }

  dispose() {
    if (this.stopped) return;
    this.elapsed = this.now();
    this.stopped = true;
    for (const wait of this.waits) {
      clearTimeout(wait.timer);
      wait.reject(new DOMException("Cancelled", "AbortError"));
    }
    this.waits.clear();
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
  }
}
