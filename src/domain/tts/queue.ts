interface Job<T> {
  key: string;
  priority: number;
  backgroundPriority?: number;
  run: () => Promise<T>;
  promise: Promise<T>;
  resolve: (result: T) => void;
  reject: (error: unknown) => void;
  started: boolean;
}
export class TtsQueue<T> {
  private jobs = new Map<string, Job<T>>();
  private active = 0;
  private backgroundActive = 0;
  private limit = 5;
  private backgroundLimit = 5;
  onChange: () => void = () => {};
  get status(): { active: number; waiting: number } { return { active: this.active, waiting: this.jobs.size - this.active }; }
  configure(limit: number, background: number): void {
    this.limit = Math.max(1, Math.min(5, Math.floor(limit) || 1));
    this.backgroundLimit = Math.max(1, Math.min(this.limit, Math.floor(background) || 1));
    this.pump();
  }
  request(key: string, run: () => Promise<T>, priority = 1): Promise<T> {
    const existing = this.jobs.get(key);
    if (existing) { if (priority > 0) existing.backgroundPriority = Math.min(priority, existing.backgroundPriority ?? priority); existing.priority = Math.min(priority, existing.priority); this.pump(); return existing.promise; }
    let resolve!: (result: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    this.jobs.set(key, { key, priority, backgroundPriority: priority > 0 ? priority : undefined, run, promise, resolve, reject, started: false });
    this.pump();
    return promise;
  }
  retainBackground(keys: Set<string>): void {
    for (const job of this.jobs.values()) if (!keys.has(job.key)) job.backgroundPriority = undefined;
    for (const [key, job] of this.jobs) if (!job.started && job.priority > 0 && !keys.has(key)) {
      this.jobs.delete(key);
      job.reject(new Error('TTS 준비 범위가 변경되었습니다.'));
    }
    this.onChange();
  }
  cancelPending(): void {
    for (const [key, job] of this.jobs) if (!job.started) {
      this.jobs.delete(key); job.reject(new Error('TTS 요청이 취소되었습니다.'));
    }
    // A cancelled UI intent does not mean Fish has freed the server-side slot.
    this.onChange();
  }
  cancelWaitingPlayback(): void {
    for (const [key,job] of this.jobs) if (!job.started && job.priority === 0) {
      if (job.backgroundPriority !== undefined) job.priority = job.backgroundPriority;
      else { this.jobs.delete(key); job.reject(new Error('다른 재생 요청으로 변경되었습니다.')); }
    }
    this.onChange();
  }
  private pump(): void {
    while (this.active < this.limit) {
      const next = [...this.jobs.values()].filter(j => !j.started && (j.priority === 0 || this.backgroundActive < this.backgroundLimit)).sort((a, b) => a.priority - b.priority)[0];
      if (!next) break;
      next.started = true;
      const background = next.priority > 0;
      this.active++;
      if (background) this.backgroundActive++;
      void Promise.resolve().then(next.run).then(next.resolve, next.reject).finally(() => {
        this.active--;
        if (background) this.backgroundActive--;
        this.jobs.delete(next.key);
        this.pump();
      });
    }
    this.onChange();
  }
}
