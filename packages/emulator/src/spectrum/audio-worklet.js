import { BeeperResampler } from './beeper-dsp.js';

export class SpectrumAudioWorklet {
  /* -------------------------- ZX constants --------------------------- */
  static T_STATES_PER_FRAME = 69_888; // PAL Spectrum
  static FRAMES_PER_SECOND = 50;
  static CPU_FREQ = SpectrumAudioWorklet.T_STATES_PER_FRAME * SpectrumAudioWorklet.FRAMES_PER_SECOND; // 3 494 400 Hz
  static MAX_EDGES_PER_FRAME = 2_048; // safe worst-case

  /* =================================================================== */
  constructor() {
    /* Audio graph (created in init) --------------------------------- */
    this.audioContext = null;
    this.workletNode = null;
    this.compressor = null;
    this.gainNode = null;

    /* Edge-buffer pool (pre-allocated, reused every frame) ---------- */
    this.edgePool = Array.from(
      { length: 4 }, // 4 buffers = 80 ms latency guard
      () => new Float64Array(SpectrumAudioWorklet.MAX_EDGES_PER_FRAME * 2),
    );

    /* Frame / beeper state ----------------------------------------- */
    this.currentLevel = 0; // last beeper level (0-1)
    this.frameEdges = []; // edges for current frame
    this.totalTStates = 0; // absolute CPU clock
    this.frameCount = 0;
    this.edgeCountTot = 0;

    /* UI / misc ----------------------------------------------------- */
    this.volume = 0.5;
    this.enabled = false;
    this.resumeButton = null;
    this.debugMode = false;
  }

  /* ============================ INIT ================================= */
  async init() {
    if (this.audioContext) {
      return this.enabled;
    }

    try {
      /* ---------- 1. Create AudioContext ------------------------- */
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
        sampleRate: 48_000, // polite request; browser may ignore
      });
      this.audioContext.addEventListener('statechange', () => this.#updateResumeBtn());

      const SR = this.audioContext.sampleRate; // actual rate granted

      /* ---------- 2. Inject AudioWorklet processor --------------- */
      const processorSrc = this.#buildProcessorSource(SR);
      const blobURL = URL.createObjectURL(new Blob([processorSrc], { type: 'application/javascript' }));
      await this.audioContext.audioWorklet.addModule(blobURL);
      URL.revokeObjectURL(blobURL);

      /* ---------- 3. Create nodes & graph ------------------------ */
      this.workletNode = new AudioWorkletNode(this.audioContext, 'zx-beeper');
      this.workletNode.port.onmessage = (e) => {
        if (e.data?.returnBuffer instanceof ArrayBuffer) {
          // Buffer returned from the worklet, reuse it.
          this.edgePool.push(new Float64Array(e.data.returnBuffer));
        }
      };

      this.compressor = this.audioContext.createDynamicsCompressor();
      /* AudioParams must be set via `.value` */
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 2;
      this.compressor.ratio.value = 2;
      this.compressor.attack.value = 0.001;
      this.compressor.release.value = 0.1;

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 0;

      this.workletNode.connect(this.compressor);
      this.compressor.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      /* ---------- 4. Fade-in & UI resume button ------------------ */
      this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      this.gainNode.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + 0.1);
      if (this.audioContext.state === 'suspended') {
        this.#createResumeBtn();
      }

      this.enabled = true;
      return true;
    } catch (err) {
      console.error('AudioWorklet init failed:', err);
      this.enabled = false;
      return false;
    }
  }

  /* =================================================================== */
  /* ---------------------- FRAME-LEVEL API ---------------------------- */
  setBeeperState(value, tState) {
    if (!this.enabled) {
      return;
    }
    const ear = value & 0x10 ? 1 : 0; // speaker bit
    const mic = value & 0x08 ? 0 : 1; // MIC is inverted
    const level = ear * 0.9 + mic * 0.33; // empiric mix

    if (level !== this.currentLevel) {
      this.frameEdges.push({ tState, level });
      this.currentLevel = level;
      ++this.edgeCountTot;
    }
  }

  startFrame() {
    // First edge guarantees we always have a starting level.
    this.frameEdges = [{ tState: 0, level: this.currentLevel }];
  }

  endFrame(frameTStates) {
    if (!this.enabled || !this.workletNode) {
      return;
    }

    this.totalTStates += frameTStates;
    ++this.frameCount;

    const buf =
      this.edgePool.pop() || // reuse if available
      new Float64Array(SpectrumAudioWorklet.MAX_EDGES_PER_FRAME * 2);

    const count = Math.min(this.frameEdges.length, SpectrumAudioWorklet.MAX_EDGES_PER_FRAME);
    for (let i = 0; i < count; ++i) {
      const e = this.frameEdges[i];
      buf[i * 2] = e.tState;
      buf[i * 2 + 1] = e.level;
    }

    this.workletNode.port.postMessage(
      {
        frame: true,
        edges: buf,
        edgeCount: count,
        frameTStates,
        syncTState: this.totalTStates,
      },
      [buf.buffer],
    ); // transfer ownership
  }

  /* =============================== UTILITIES ========================= */
  reset() {
    if (!this.enabled) {
      return;
    }
    this.gainNode?.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.02);

    this.currentLevel = 0;
    this.frameEdges = [];
    this.totalTStates = 0;
    this.frameCount = 0;
    this.edgeCountTot = 0;

    this.workletNode?.port.postMessage({ reset: true });

    setTimeout(() => {
      this.gainNode?.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + 0.05);
    }, 30);
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gainNode) {
      this.gainNode.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, this.volume),
        this.audioContext.currentTime + 0.1,
      );
    }
  }
  setMuted(muted) {
    this.setVolume(muted ? 0 : this.volume);
  }
  setDebugMode(on) {
    this.debugMode = !!on;
  }

  isReady() {
    return this.enabled && this.audioContext?.state === 'running';
  }

  getStats() {
    return {
      enabled: this.enabled,
      contextState: this.audioContext ? this.audioContext.state : 'closed',
      sampleRate: this.audioContext ? this.audioContext.sampleRate : 0,
      totalTStates: this.totalTStates,
      frameCount: this.frameCount,
      totalEdges: this.edgeCountTot,
      bufferSize: SpectrumAudioWorklet.MAX_EDGES_PER_FRAME,
      volume: this.volume,
    };
  }

  /* ---------------------------- SHUTDOWN ----------------------------- */
  async stop() {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;

    this.gainNode?.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.05);
    await new Promise((res) => setTimeout(res, 60));

    this.workletNode?.disconnect();
    this.compressor?.disconnect();
    this.gainNode?.disconnect();
    await this.audioContext?.close();

    this.workletNode = this.compressor = this.gainNode = this.audioContext = null;
    this.resumeButton?.remove();
    this.resumeButton = null;
  }

  /* ======================= PRIVATE HELPERS =========================== */
  #buildProcessorSource(sr) {
    /* String-template so we can embed sample-rate-dependent constants. The
       shared band-limited resampler is inlined via toString() so there is one
       source of truth for the DSP across the worklet, the fallback and tests. */
    return `
            const BeeperResampler = ${BeeperResampler.toString()};

            class ZXBeeperProcessor extends AudioWorkletProcessor {
                constructor () {
                    super();
                    this.sr = ${sr};
                    this.samplesPerFrame = Math.round(this.sr / 50);
                    this.resampler = new BeeperResampler(this.sr, ${SpectrumAudioWorklet.CPU_FREQ});
                    this.tmp = new Float32Array(this.samplesPerFrame + 16);

                    /* Sample ring buffer: decouples bursty postMessage frame
                       delivery from the steady audio callback, so late or
                       batched frames no longer drop/repeat (the old clicks). */
                    this.RING   = this.samplesPerFrame * 8;
                    this.ring   = new Float32Array(this.RING);
                    this.rHead  = 0;
                    this.rTail  = 0;
                    this.avail  = 0;
                    this.lastOut = 0;

                    this.port.onmessage = e => this.#onMessage(e.data);
                }

                #onMessage (d) {
                    if (d.frame) {
                        const edgeBuf = new Float64Array(d.edges);
                        const n = this.resampler.renderFrame(
                            edgeBuf, d.edgeCount | 0, d.frameTStates | 0, this.tmp);
                        for (let s = 0; s < n; ++s) {
                            if (this.avail < this.RING) {
                                this.ring[this.rHead] = this.tmp[s];
                                this.rHead = (this.rHead + 1) % this.RING;
                                ++this.avail;
                            }
                        }
                        /* return buffer for reuse */
                        this.port.postMessage({ returnBuffer: edgeBuf.buffer },
                                              [edgeBuf.buffer]);
                    } else if (d.reset) {
                        this.resampler.reset();
                        this.rHead = this.rTail = this.avail = 0;
                        this.lastOut = 0;
                    }
                }

                process (_in, out) {
                    const ch = out[0][0];
                    if (!ch) return true;
                    for (let i = 0, n = ch.length; i < n; ++i) {
                        if (this.avail > 0) {
                            this.lastOut = this.ring[this.rTail];
                            this.rTail = (this.rTail + 1) % this.RING;
                            --this.avail;
                        }
                        ch[i] = this.lastOut; // hold last sample on underrun (click-free)
                    }
                    return true;
                }
            }
            registerProcessor("zx-beeper", ZXBeeperProcessor);
        `;
  }

  /* ----------- resume-button helpers (unchanged UI) ------------------ */
  #createResumeBtn() {
    // Resume button creation disabled - audio context will be resumed programmatically
    return;
  }
  #updateResumeBtn() {
    // No resume button to update
    return;
  }
}
