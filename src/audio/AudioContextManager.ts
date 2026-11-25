export class AudioContextManager {
  private ctx: AudioContext | null = null;
  private visibilityBound = false;

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public getCurrentTime(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  public setCustomContext(customCtx: AudioContext | null): void {
    this.ctx = customCtx;
  }

  public ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;

    this.ctx = new AudioCtx({ latencyHint: "interactive" });
    this.bindVisibilityRecovery();
    return this.ctx;
  }

  public unlock(): AudioContext | null {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {
        // Ignore resume failure prior to user gesture
      });
    }
    return ctx;
  }

  private bindVisibilityRecovery(): void {
    if (this.visibilityBound || typeof document === "undefined") return;
    this.visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        this.ctx &&
        this.ctx.state === "suspended"
      ) {
        void this.ctx.resume().catch(() => {
          // Ignore
        });
      }
    });
  }
}
