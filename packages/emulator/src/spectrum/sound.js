/**
 * ZX Spectrum Sound (Beeper) Emulation - Fallback Implementation
 * Uses ScriptProcessorNode for browsers that don't support AudioWorklet
 *
 * Note: ScriptProcessorNode is deprecated but still widely supported
 * This serves as a fallback when AudioWorklet is not available
 */
export class SpectrumSound {
  constructor() {
    this.audioContext = null;
    this.gainNode = null;
    this.compressor = null;
    this.scriptNode = null;
    this.enabled = false;
    this.volume = 0.3;

    // Timing
    this.cpuFrequency = 3500000; // 3.5 MHz
    this.currentBeeperState = 0;
    this.lastBeeperState = 0;
    this.beeperChanges = [];
    this.frameStartTState = 0;
    this.totalTStates = 0;

    // Buffer for more accurate sound generation
    this.sampleRate = 44100;
    this.bufferSize = 2048; // Smaller buffer for lower latency
    this.tStatesPerSample = this.cpuFrequency / this.sampleRate;

    // Audio processing state
    this.lastTState = 0;
    this.edges = [];
    this.edgeIndex = 0;
    this.currentLevel = 0;
    this.targetLevel = 0;

    // Filters
    this.filterCoeff = 0.3; // Low-pass filter
    this.lastOutput = 0;

    // DC blocker
    this.dcBlockerCoeff = 0.995;
    this.lastInput = 0;
    this.lastDCOutput = 0;

    // Debug
    this.debugMode = false;
    this.edgeCount = 0;
  }

  /**
   * Initialize Web Audio API
   */
  async init() {
    if (this.audioContext) {
      return this.enabled;
    }

    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
        sampleRate: this.sampleRate,
      });

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.volume;

      // Add compressor to prevent clipping
      this.compressor = this.audioContext.createDynamicsCompressor();
      this.compressor.threshold.value = -10;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.001;
      this.compressor.release.value = 0.1;

      // Create script processor for custom waveform generation
      // Note: ScriptProcessorNode is deprecated but still needed for compatibility
      this.scriptNode = this.audioContext.createScriptProcessor(this.bufferSize, 0, 1);
      this.scriptNode.onaudioprocess = (event) => {
        this.processAudio(event);
      };

      // Connect audio graph
      this.scriptNode.connect(this.compressor);
      this.compressor.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.enabled = true;
      console.log('Basic sound (ScriptProcessor) initialized at', this.sampleRate, 'Hz'); // eslint-disable-line no-console
      return true;
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      this.enabled = false;
      return false;
    }
  }

  /**
   * Process audio in the ScriptProcessor callback
   */
  processAudio(event) {
    const output = event.outputBuffer.getChannelData(0);

    for (let i = 0; i < output.length; i++) {
      // Calculate the T-state for this sample
      const currentTState = this.lastTState + i * this.tStatesPerSample;

      // Process any edges that occurred before this sample
      while (this.edgeIndex < this.edges.length && this.edges[this.edgeIndex].tState <= currentTState) {
        const edge = this.edges[this.edgeIndex++];
        // Immediate level change for sharper edges
        this.targetLevel = edge.value ? 0.7 : -0.7;
      }

      // Move current level towards target (slight smoothing)
      this.currentLevel = this.currentLevel + (this.targetLevel - this.currentLevel) * 0.8;

      // Apply low-pass filter
      const filtered = this.lastOutput + (this.currentLevel - this.lastOutput) * this.filterCoeff;
      this.lastOutput = filtered;

      // DC blocker to remove clicks and pops
      const dcBlocked = filtered - this.lastInput + this.dcBlockerCoeff * this.lastDCOutput;
      this.lastInput = filtered;
      this.lastDCOutput = dcBlocked;

      // Write sample with controlled amplitude
      output[i] = dcBlocked * 0.6;
    }

    // Update time state for next buffer
    this.lastTState += output.length * this.tStatesPerSample;

    // Clean up processed edges
    if (this.edgeIndex > 1000) {
      this.edges = this.edges.slice(this.edgeIndex);
      this.edgeIndex = 0;
    }

    // Sync with frame timing
    if (this.edges.length === 0 && this.beeperChanges.length > 0) {
      // Process pending changes
      this.edges.push(...this.beeperChanges);
      this.beeperChanges = [];
    }
  }

  /**
   * Record a beeper state change with exact timing
   * Compatible with AudioWorklet API
   */
  setBeeperState(value, tState) {
    if (!this.enabled) {
      return;
    }

    const newState = value & 0x10 ? 1 : 0;

    if (newState !== this.currentBeeperState || this.beeperChanges.length === 0) {
      const absoluteTState = this.frameStartTState + tState;

      // Ensure edges are in chronological order
      if (this.beeperChanges.length > 0 && absoluteTState <= this.beeperChanges[this.beeperChanges.length - 1].tState) {
        return;
      }

      this.beeperChanges.push({
        tState: absoluteTState,
        value: newState,
      });
      this.currentBeeperState = newState;

      if (this.debugMode && this.edgeCount < 100) {
        // eslint-disable-next-line no-console
        console.log(
          `[Basic] Edge ${this.edgeCount++}: ${this.lastBeeperState} -> ${newState} at T-state ${absoluteTState}`,
        );
      }
      this.lastBeeperState = newState;
    }
  }

  /**
   * Start a new frame - compatible with AudioWorklet API
   */
  startFrame() {
    this.frameStartTState = this.totalTStates;
    // Don't clear beeperChanges here - let them accumulate
  }

  /**
   * End frame and process changes - compatible with AudioWorklet API
   */
  endFrame(frameTStates) {
    if (!this.enabled) {
      return;
    }

    this.totalTStates = this.frameStartTState + frameTStates;

    // The changes will be processed in the audio callback
    // This avoids timing issues with the main thread

    if (this.debugMode && this.beeperChanges.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[Basic] Frame ended: ${this.beeperChanges.length} edges pending`);
    }
  }

  /**
   * Reset audio state
   */
  reset() {
    this.currentBeeperState = 0;
    this.lastBeeperState = 0;
    this.beeperChanges = [];
    this.edges = [];
    this.edgeIndex = 0;
    this.frameStartTState = 0;
    this.totalTStates = 0;
    this.lastTState = 0;
    this.currentLevel = 0;
    this.targetLevel = 0;
    this.lastOutput = 0;
    this.lastInput = 0;
    this.lastDCOutput = 0;
    this.edgeCount = 0;
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) {
      // Use exponential ramp for smoother volume changes
      this.gainNode.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, this.volume),
        this.audioContext.currentTime + 0.1,
      );
    }
  }

  /**
   * Mute/unmute
   */
  setMuted(muted) {
    if (this.gainNode) {
      const targetValue = muted ? 0.0001 : this.volume;
      this.gainNode.gain.exponentialRampToValueAtTime(targetValue, this.audioContext.currentTime + 0.05);
    }
  }

  /**
   * Enable/disable debug mode
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
    this.edgeCount = 0;
  }

  /**
   * Start audio - compatible with AudioWorklet API
   */
  async start() {
    return await this.init();
  }

  /**
   * Stop audio
   */
  stop() {
    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }

    if (this.compressor) {
      this.compressor.disconnect();
      this.compressor = null;
    }

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.enabled = false;
  }

  /**
   * Check if audio is ready
   */
  isReady() {
    return this.enabled && this.audioContext?.state === 'running';
  }

  /**
   * Get audio statistics - compatible with AudioWorklet API
   */
  getStats() {
    return {
      enabled: this.enabled,
      contextState: this.audioContext?.state,
      sampleRate: this.audioContext?.sampleRate,
      edgesQueued: this.beeperChanges.length,
      totalTStates: this.totalTStates,
      implementation: 'ScriptProcessor (Fallback)',
    };
  }

  /**
   * Legacy beep method (no longer used but kept for compatibility)
   */
  beep(speakerBit) {
    // Convert to new API
    this.setBeeperState(speakerBit ? 0x10 : 0x00, 0);
  }
}
