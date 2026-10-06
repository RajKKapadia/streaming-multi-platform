import type { Playback } from "@studio/contracts";

/** Sound cues are events: delivery latency must not skip their attack or truncate their tail. */
export class SoundPlayback {
  private seenId: string | null = null;
  private active: Playback | null = null;

  update(playback: Playback | null, now: number, cancelled = false) {
    let restart = false;
    if (cancelled) this.active = null;
    else if (playback) {
      if (playback.id !== this.seenId) {
        // Do not replay old room metadata after a reconnect.
        this.active =
          now - playback.startedAt <= Math.max(5000, playback.duration * 1000) ? playback : null;
        if (this.active) this.seenId = playback.id;
        restart = !!this.active;
      } else if (this.active) this.active = playback;
    } else if (this.active) {
      const end = this.active.startedAt + (this.active.duration - this.active.position) * 1000;
      // A stop before the shared end cancels the cue. Natural state expiry lets local audio finish.
      if (!this.active.playing || this.active.loop || now < end) this.active = null;
    }
    return { playback: this.active, restart };
  }

  finish() {
    this.active = null;
  }
}
