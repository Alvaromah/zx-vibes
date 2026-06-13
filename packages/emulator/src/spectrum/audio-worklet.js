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
    /* String-template so we can embed sample-rate-dependent constants */
    return `
            class ZXBeeperProcessor extends AudioWorkletProcessor {
                static T_STATES_PER_FRAME = 69888;
                static FRAMES_PER_SECOND  = 50;
                static CPU_FREQ = ZXBeeperProcessor.T_STATES_PER_FRAME *
                                   ZXBeeperProcessor.FRAMES_PER_SECOND;

                constructor () {
                    super();
                    this.sr = ${sr};                              // fixed
                    this.tStatesPerSample =
                        ZXBeeperProcessor.CPU_FREQ / this.sr;
                    this.samplesPerFrame =
                        Math.round(this.sr / ZXBeeperProcessor.FRAMES_PER_SECOND);

                    /* Edge data -------------------------------------- */
                    this.edgeBuf      = null;
                    this.edgeCount    = 0;

                    /* Synth state ----------------------------------- */
                    this.currentLevel    = 0;
                    this.generatorTState = 0;      // absolute

                    /* Filters: 3.5 kHz low-pass + DC blocker -------- */
                    const fc = 3500;
                    this.lpAlpha =
                        1 - Math.exp(-2 * Math.PI * fc / this.sr);
                    this.lpState   = 0;
                    this.dcCoeff   = 0.9995;
                    this.dcPrevIn  = 0;
                    this.dcPrevOut = 0;

                    /* Frame buffer ---------------------------------- */
                    this.frameBuf   =
                        new Float32Array(this.samplesPerFrame + 128);
                    this.fbPos      = 0;
                    this.frameReady = false;

                    this.port.onmessage = e => this.#onMessage(e.data);
                }

                /* ------------------ messages ---------------------- */
                #onMessage (d) {
                    if (d.frame) {
                        this.edgeBuf      = new Float64Array(d.edges);
                        this.edgeCount    = d.edgeCount | 0;
                        this.frameTStates = d.frameTStates | 0;
                        this.syncTState   = d.syncTState | 0;

                        this.#renderFrame();
                        this.frameReady = true;

                    } else if (d.reset) {
                        this.currentLevel = 0;
                        this.lpState      = 0;
                        this.dcPrevIn     = 0;
                        this.dcPrevOut    = 0;
                        this.fbPos        = 0;
                        this.frameReady   = false;
                        this.generatorTState = 0;
                    }
                }

                /* -------------- render single 20 ms frame ---------- */
                #renderFrame () {
                    const N = this.samplesPerFrame;
                    let eix = 0;

                    for (let s = 0; s < N; ++s) {
                        const relTS = s * this.tStatesPerSample;
                        while (eix < this.edgeCount &&
                               this.edgeBuf[eix * 2] <= relTS) {
                            this.currentLevel = this.edgeBuf[eix * 2 + 1];
                            ++eix;
                        }

                        /* low-pass */
                        this.lpState += this.lpAlpha *
                                        (this.currentLevel - this.lpState);

                        /* bipolar + DC-block */
                        const bb  = (this.lpState - 0.5) * 2;
                        const out = bb - this.dcPrevIn +
                                    this.dcCoeff * this.dcPrevOut;
                        this.dcPrevIn  = bb;
                        this.dcPrevOut = out;

                        this.frameBuf[s] = out * 0.6;
                    }

                    /* advance generator clock & PLL correction */
                    this.generatorTState += N * this.tStatesPerSample;
                    const drift = this.syncTState - this.generatorTState;
                    this.generatorTState += drift * 0.05;        // 5 % pull

                    this.fbPos = 0;

                    /* return buffer for reuse */
                    this.port.postMessage({ returnBuffer: this.edgeBuf.buffer },
                                          [this.edgeBuf.buffer]);
                    this.edgeBuf = null;
                    this.edgeCount = 0;
                }

                /* ---------------- audio callback ------------------ */
                process (_in, out) {
                    const ch = out[0][0];
                    if (!ch) return true;

                    for (let i = 0, n = ch.length; i < n; ++i) {
                        if (this.frameReady && this.fbPos < this.samplesPerFrame) {
                            ch[i] = this.frameBuf[this.fbPos++];
                        } else {
                            /* hold last sample to avoid clicks */
                            ch[i] = this.fbPos ? this.frameBuf[this.fbPos - 1] : 0;
                        }
                        if (this.fbPos >= this.samplesPerFrame) {
                            this.frameReady = false;
                            this.fbPos = 0;
                        }
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
