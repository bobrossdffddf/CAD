// Strict FIFO job queue: if 3 people talk at once, segments are processed
// one at a time in the order their speech ENDED. A failed job never blocks the next.

export class JobQueue {
  constructor(handler, name = 'queue') {
    this.handler = handler;
    this.name = name;
    this.jobs = [];
    this.running = false;
  }

  push(job) {
    this.jobs.push(job);
    this.#drain();
  }

  get size() { return this.jobs.length; }

  async #drain() {
    if (this.running) return;
    this.running = true;
    while (this.jobs.length) {
      const job = this.jobs.shift();
      try {
        await this.handler(job);
      } catch (err) {
        console.error(`[${this.name}] job failed:`, err);
      }
    }
    this.running = false;
  }
}
