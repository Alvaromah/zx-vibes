/**
 * Band-limited beeper resampler (pure DSP, no Web Audio / DOM).
 *
 * The ZX beeper is a 1-bit speaker: tones are square waves whose edges fall on
 * arbitrary T-states, not on the audio sample grid. Point-sampling the level at
 * each output sample (the previous approach) snaps every edge to the nearest
 * sample, jittering the square wave's duty cycle and folding high harmonics back
 * into the audible band — the "dirty"/rough beeper.
 *
 * This resampler integrates the speaker level over each output sample's exact
 * time window using the edge T-states (time-weighted average) — a box-filter
 * anti-aliaser that captures sub-sample edge positions, so pitch and duty cycle
 * are accurate and aliasing is suppressed. A gentle one-pole low-pass softens the
 * very top end and a DC blocker removes clicks/offset.
 *
 * It is driven per emulation frame with frame-relative edges and the frame's
 * exact T-state length, and emits a VARIABLE number of samples per frame so the
 * output clock never drifts from real time (a frame is 69888 T-states =
 * 19.968 ms, not exactly 20 ms). Partial-sample state carries across frames.
 *
 * Self-contained on purpose: the AudioWorklet processor is injected as source
 * text, so this class is embedded there via `toString()`. Keep it dependency-free.
 */
export class BeeperResampler {
  /**
   * @param {number} sampleRate  output sample rate (Hz)
   * @param {number} cpuFreq     CPU T-states per second (48K PAL frame clock = 3.4944 MHz)
   * @param {number} lpCutoff    one-pole low-pass cutoff (Hz)
   */
  constructor(sampleRate, cpuFreq = 3494400, lpCutoff = 7000) {
    this.tps = cpuFreq / sampleRate; // T-states per output sample
    this.level = 0; // carried speaker level (0..~1.2 with mic mix)
    this.windowFilled = 0; // T-states already integrated into the in-progress sample
    this.accCarry = 0; // area (level·T-states) accumulated for the in-progress sample
    this.lpAlpha = 1 - Math.exp((-2 * Math.PI * lpCutoff) / sampleRate);
    this.lp = 0;
    this.dcCoeff = 0.9995;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
  }

  /**
   * Render one emulation frame. Emits as many whole samples as fit the frame's
   * real duration and carries the partial sample to the next frame, so the
   * sample clock stays locked to emulation time.
   *
   * @param {Float64Array} edges    flat [tState, level] pairs, frame-relative, ascending
   * @param {number} count          number of edge pairs
   * @param {number} frameTStates   exact T-state length of this frame
   * @param {Float32Array} out      destination (>= ~tps^-1·frameTStates + 1 samples)
   * @returns {number}              samples written to `out`
   */
  renderFrame(edges, count, frameTStates, out) {
    const tps = this.tps;
    let eix = 0;
    let cur = 0; // integration cursor within this frame
    let level = this.level;
    let written = 0;

    for (;;) {
      const need = tps - this.windowFilled; // T-states left to finish current sample
      let end = cur + need;
      if (end <= frameTStates + 1e-6) {
        if (end > frameTStates) {
          end = frameTStates;
        }
        // sample completes inside this frame: integrate [cur, end)
        let area = 0;
        while (eix < count && edges[eix * 2] < end) {
          const et = edges[eix * 2];
          if (et > cur) { area += level * (et - cur); cur = et; }
          level = edges[eix * 2 + 1];
          ++eix;
        }
        area += level * (end - cur);
        cur = end;
        const avg = (this.accCarry + area) / tps;
        this.accCarry = 0;
        this.windowFilled = 0;
        out[written++] = this._shape(avg);
      } else {
        // frame ends mid-sample: integrate [cur, frameTStates) and carry the partial
        let area = 0;
        while (eix < count && edges[eix * 2] < frameTStates) {
          const et = edges[eix * 2];
          if (et > cur) { area += level * (et - cur); cur = et; }
          level = edges[eix * 2 + 1];
          ++eix;
        }
        area += level * (frameTStates - cur);
        this.accCarry += area;
        this.windowFilled += frameTStates - cur;
        break;
      }
    }
    this.level = level;
    return written;
  }

  /** one-pole low-pass + bipolar + DC blocker + output trim */
  _shape(avg) {
    this.lp += this.lpAlpha * (avg - this.lp);
    const bipolar = (this.lp - 0.5) * 2;
    const out0 = bipolar - this.dcPrevIn + this.dcCoeff * this.dcPrevOut;
    this.dcPrevIn = bipolar;
    this.dcPrevOut = out0;
    return out0 * 0.6;
  }

  reset() {
    this.level = 0;
    this.windowFilled = 0;
    this.accCarry = 0;
    this.lp = 0;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
  }
}
