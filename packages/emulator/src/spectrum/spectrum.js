import { Z80 } from '../core/cpu.js';
import { SpectrumMemory } from './memory.js';
import { SpectrumULA, SPECTRUM_KEYS, PC_KEY_MAP } from './ula.js';
import { SpectrumDisplay } from './display.js';
import { SpectrumSound } from './sound.js';
import { SpectrumAudioWorklet } from './audio-worklet.js';
import { Z80SnapshotLoader } from './snapshot.js';
import { Tape } from './tape.js';
import { TouchKeyboard } from './touch-keyboard.js';

/**
 * ZXSpectrum - Main emulator class for the ZX Spectrum 48K
 *
 * @class ZXSpectrum
 * @example
 * const spectrum = new ZXSpectrum('#canvas', {
 *     scale: 2,
 *     sound: true,
 *     autoStart: true
 * });
 */
export class ZXSpectrum {
  /**
   * Create a new ZX Spectrum emulator instance
   *
   * @constructor
   * @param {string|HTMLCanvasElement} canvasOrSelector - Canvas element or CSS selector
   * @param {Object} [options={}] - Configuration options
   * @param {string|Uint8Array} [options.rom='https://cdn.jsdelivr.net/npm/zx-generation@latest/rom/48k.rom'] - ROM data or URL
   * @param {boolean} [options.autoStart=true] - Start emulation automatically after ROM loads
   * @param {boolean} [options.sound=true] - Enable sound emulation
   * @param {boolean} [options.useAudioWorklet=true] - Use AudioWorklet for better sound
   * @param {number|string} [options.scale='auto'] - Display scale factor
   * @param {boolean} [options.handleKeyboard=true] - Handle keyboard input automatically
   * @param {boolean|string} [options.touchKeyboard='auto'] - Touch keyboard support
   * @param {number} [options.fps=50] - Frames per second (PAL standard)
   * @param {Function} [options.onReady] - Callback when emulator is ready
   * @param {Function} [options.onError] - Error callback
   */
  constructor(canvasOrSelector, options = {}) {
    // Initialize options with defaults
    this.options = {
      rom: 'https://cdn.jsdelivr.net/npm/zx-generation@latest/rom/48k.rom',
      autoStart: true,
      sound: true,
      useAudioWorklet: true,
      scale: 'auto',
      handleKeyboard: true,
      touchKeyboard: 'auto', // 'auto', true, false, or custom element/selector
      fps: 50,
      onReady: null,
      onError: null,
      ...options,
    };

    // Get or create canvas
    this.canvas = this._resolveCanvas(canvasOrSelector);
    this.ctx = this.canvas.getContext('2d');

    // Initialize hardware components
    this.memory = new SpectrumMemory();
    this.ula = new SpectrumULA();
    this.display = new SpectrumDisplay();

    // Initialize sound if enabled
    this.useAudioWorklet = this.options.sound && this.options.useAudioWorklet;
    if (this.options.sound) {
      this.sound = this.useAudioWorklet ? new SpectrumAudioWorklet() : new SpectrumSound();
    } else {
      this.sound = null;
    }

    this.cpu = new Z80(this.memory, this.ula);
    this.tape = new Tape(this);

    // Setup sound callbacks
    if (this.sound) {
      this.ula.setPortWriteCallback((portValue) => {
        if (this.sound && this.sound.enabled && this.useAudioWorklet) {
          const tStateOffset = this.cpu.cycles - this.frameStartCycles;
          this.sound.setBeeperState(portValue, tStateOffset);
        }
      });

      this.ula.onSpeakerChange = (speakerBit) => {
        if (this.sound && this.sound.enabled) {
          if (!this.useAudioWorklet && this.sound.beep) {
            this.sound.beep(speakerBit);
          }
        }
      };
    }

    // Emulation timing
    this.FRAMES_PER_SECOND = this.options.fps;
    this.TSTATES_PER_FRAME = 69888;
    this.INTERRUPT_TSTATES = 32;

    // State
    this.running = false;
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.accumulatedTime = 0;
    this.frameStartCycles = 0;

    // Stats
    this.fps = 0;
    this.lastFpsUpdate = 0;
    this.framesSinceLastFps = 0;

    // Animation
    this.animationId = null;
    this.renderAnimationId = null;

    // Features
    this.turboMode = false;

    // Custom key mappings
    this.customKeyMap = {};

    // Touch keyboard
    this.touchKeyboard = null;

    // Setup canvas
    this._setupCanvas();

    // Setup keyboard handling if enabled
    if (this.options.handleKeyboard) {
      this._setupKeyboard();
    }

    // Setup touch keyboard if needed
    if (this.options.touchKeyboard !== false) {
      this._setupTouchKeyboard();
    }

    // Setup visibility handling
    this._setupVisibilityHandling();

    // Initialize with ROM if provided
    if (this.options.rom) {
      this._initialize();
    }
  }

  /**
   * Resolve canvas element from selector or element
   *
   * @private
   * @param {string|HTMLCanvasElement} canvasOrSelector - Canvas element or CSS selector
   * @returns {HTMLCanvasElement} Canvas element
   * @throws {Error} If canvas element not found or invalid
   */
  _resolveCanvas(canvasOrSelector) {
    if (typeof canvasOrSelector === 'string') {
      // It's a selector
      if (typeof document === 'undefined') {
        throw new Error(
          'Canvas selectors need a DOM. In Node, pass a canvas-like object ' +
            '(e.g. from the "canvas" package) instead of a selector string.',
        );
      }
      const element = document.querySelector(canvasOrSelector);
      if (!element) {
        throw new Error(`Canvas element not found: ${canvasOrSelector}`);
      }
      if (element.tagName !== 'CANVAS') {
        // Create a canvas inside the element
        const canvas = document.createElement('canvas');
        element.appendChild(canvas);
        return canvas;
      }
      return element;
    }
    if (typeof HTMLCanvasElement !== 'undefined' && canvasOrSelector instanceof HTMLCanvasElement) {
      return canvasOrSelector;
    }
    if (canvasOrSelector && canvasOrSelector.tagName === 'CANVAS') {
      return canvasOrSelector;
    }
    throw new Error('Invalid canvas parameter. Expected selector string or canvas element.');
  }

  /**
   * Setup canvas dimensions and rendering properties
   *
   * @private
   * @returns {void}
   */
  _setupCanvas() {
    const displaySize = this.display.getDisplaySize();

    // Set internal canvas size
    this.canvas.width = displaySize.width;
    this.canvas.height = displaySize.height;

    // Handle scaling
    if (this.options.scale === 'auto') {
      // Default 2x scale
      this.canvas.style.width = `${displaySize.width * 2}px`;
      this.canvas.style.height = `${displaySize.height * 2}px`;
    } else if (typeof this.options.scale === 'number') {
      this.canvas.style.width = `${displaySize.width * this.options.scale}px`;
      this.canvas.style.height = `${displaySize.height * this.options.scale}px`;
    }

    // Pixelated rendering
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.imageRendering = '-moz-crisp-edges';
    this.canvas.style.imageRendering = 'crisp-edges';
  }

  /**
   * Setup keyboard event handlers
   *
   * @private
   * @returns {void}
   */
  _setupKeyboard() {
    // Store bound functions for removal
    this._keyDownHandler = (e) => this._handleKeyDown(e);
    this._keyUpHandler = (e) => this._handleKeyUp(e);

    // Add event listeners (headless callers drive keyDown()/keyUp() directly)
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this._keyDownHandler);
      document.addEventListener('keyup', this._keyUpHandler);
    }
  }

  /**
   * Setup touch keyboard for mobile devices
   *
   * @private
   * @returns {void}
   */
  _setupTouchKeyboard() {
    const shouldShow = this.options.touchKeyboard === 'auto' ? this._isTouchDevice() : this.options.touchKeyboard;

    if (shouldShow) {
      if (typeof document === 'undefined') {
        return;
      }
      // Determine container
      let container;
      if (typeof this.options.touchKeyboard === 'string' && this.options.touchKeyboard !== 'auto') {
        container = this.options.touchKeyboard;
      } else {
        if (!this.canvas.parentNode) {
          return;
        }
        // Create container after canvas
        container = document.createElement('div');
        container.className = 'zx-touch-container';
        this.canvas.parentNode.insertBefore(container, this.canvas.nextSibling);
      }

      this.touchKeyboard = new TouchKeyboard(this, container);
    }
  }

  /**
   * Check if device supports touch input
   *
   * @private
   * @returns {boolean} True if touch device
   */
  _isTouchDevice() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false; // headless
    }
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
  }

  /**
   * Handle keyboard key down events
   *
   * @private
   * @param {KeyboardEvent} e - Keyboard event
   * @returns {void}
   */
  _handleKeyDown(e) {
    if (!this.running) {
      return;
    }

    const handled = this._processKey(e.key, true);
    if (handled) {
      e.preventDefault();
    }
  }

  /**
   * Handle keyboard key up events
   *
   * @private
   * @param {KeyboardEvent} e - Keyboard event
   * @returns {void}
   */
  _handleKeyUp(e) {
    if (!this.running) {
      return;
    }

    const handled = this._processKey(e.key, false);
    if (handled) {
      e.preventDefault();
    }
  }

  /**
   * Process key press/release for Spectrum keyboard mapping
   *
   * @private
   * @param {string} key - Key string
   * @param {boolean} isDown - True if key pressed, false if released
   * @returns {boolean} True if key was handled
   */
  _processKey(key, isDown) {
    // Check custom mappings first
    const customMapping = this.customKeyMap[key];
    if (customMapping) {
      if (typeof customMapping === 'string') {
        return this._processKey(customMapping, isDown);
      }
      if (customMapping.keys) {
        customMapping.keys.forEach((k) => this._processKey(k, isDown));
        return true;
      }
    }

    // Check PC key mappings
    const pcMapping = PC_KEY_MAP[key];
    if (pcMapping) {
      if (typeof pcMapping === 'string') {
        // Direct mapping to a Spectrum key
        const keyMapping = SPECTRUM_KEYS[pcMapping];
        if (keyMapping) {
          this.ula.setKey(keyMapping.row, keyMapping.col, isDown);
          return true;
        }
      } else if (pcMapping.keys) {
        // Multiple keys need to be pressed
        pcMapping.keys.forEach((spectrumKey) => {
          const keyMapping = SPECTRUM_KEYS[spectrumKey];
          if (keyMapping) {
            this.ula.setKey(keyMapping.row, keyMapping.col, isDown);
          }
        });
        return true;
      }
    }

    // Check direct Spectrum key mapping
    const keyMapping = SPECTRUM_KEYS[key] || SPECTRUM_KEYS[key.toUpperCase()];
    if (keyMapping) {
      this.ula.setKey(keyMapping.row, keyMapping.col, isDown);
      return true;
    }

    return false;
  }

  /**
   * Setup page visibility handling for audio context
   *
   * @private
   * @returns {void}
   */
  _setupVisibilityHandling() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (this.running && this.sound && this.sound.audioContext) {
          if (document.hidden) {
            this.sound.audioContext.suspend().catch((err) => console.warn('Failed to suspend audio context:', err));
          } else {
            this.sound.audioContext.resume().catch((err) => console.warn('Failed to resume audio context:', err));
          }
        }
      });
    }
  }

  /**
   * Initialize emulator with ROM and options
   *
   * @private
   * @async
   * @returns {Promise<void>}
   */
  async _initialize() {
    try {
      if (this.options.rom instanceof Uint8Array) {
        this.loadROM(this.options.rom);
      } else if (typeof this.options.rom === 'string') {
        await this.loadROMFromURL(this.options.rom);
      }

      if (this.options.onReady) {
        this.options.onReady(this);
      }

      if (this.options.autoStart) {
        await this.start();
      }
    } catch (error) {
      console.error('Failed to initialize emulator:', error);
      if (this.options.onError) {
        this.options.onError(error);
      }
    }
  }

  /**
   * Load ROM data into the emulator
   *
   * @param {Uint8Array} romData - ROM data (must be 16384 bytes)
   * @throws {Error} If romData is not a Uint8Array
   */
  loadROM(romData) {
    if (!(romData instanceof Uint8Array)) {
      throw new Error('ROM data must be a Uint8Array');
    }
    this.memory.loadROM(romData);
    this.reset();
  }

  /**
   * Load ROM from a URL
   *
   * @async
   * @param {string} url - URL to ROM file
   * @throws {Error} If ROM loading fails
   */
  async loadROMFromURL(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load ROM: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const romData = new Uint8Array(arrayBuffer);
      this.loadROM(romData);
    } catch (error) {
      throw new Error(`Error loading ROM from URL: ${error.message}`);
    }
  }

  /**
   * Reset the emulator to initial state
   */
  reset() {
    this.cpu.reset();
    this.memory.clearRAM();
    this.ula.clearKeys();
    this.ula.borderColor = 1;
    this.frameCount = 0;

    const attrs = this.memory.getAttributeMemory();
    attrs.fill(0x38);

    if (this.sound && this.sound.reset) {
      this.sound.reset();
    }

    const screenMem = this.memory.getScreenMemory();
    const attrMem = this.memory.getAttributeMemory();

    for (let i = 0; i < attrMem.length; i++) {
      attrMem[i] = 0x38;
    }
  }

  /**
   * Run a single frame of emulation (69888 T-states)
   *
   * @private
   * @returns {void}
   */
  runFrame() {
    let tStates = 0;

    this.frameStartCycles = this.cpu.cycles;
    if (this.useAudioWorklet && this.sound && this.sound.startFrame) {
      this.sound.startFrame();
    }

    while (tStates < this.TSTATES_PER_FRAME) {
      const beforeCycles = this.cpu.cycles;
      this.cpu.execute();
      const cyclesExecuted = this.cpu.cycles - beforeCycles;

      this.ula.addCycles(cyclesExecuted);

      const tapeInputBit = this.tape.update(this.cpu.cycles);
      this.ula.setTapeInput(tapeInputBit);

      if (this.ula.shouldGenerateInterrupt()) {
        this.cpu.interrupt();
      }

      tStates += cyclesExecuted;
    }

    if (this.useAudioWorklet && this.sound && this.sound.endFrame) {
      this.sound.endFrame(tStates);
    }

    this.frameCount++;
    this.display.advanceFrame();

    const now = performance.now();
    this.framesSinceLastFps++;
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.framesSinceLastFps;
      this.framesSinceLastFps = 0;
      this.lastFpsUpdate = now;
    }
  }

  /**
   * Start the emulation
   *
   * @async
   * @returns {Promise<void>}
   */
  async start() {
    if (this.running) {
      return;
    }

    // Initialize sound if enabled
    if (this.sound) {
      if (this.useAudioWorklet) {
        try {
          let success = await this.sound.init();

          if (!success && this.sound.audioContext && this.sound.audioContext.state === 'suspended') {
            try {
              await this.sound.audioContext.resume();
              success = true;
              this.sound.enabled = true;
            } catch (err) {
              console.warn('Failed to resume audio context:', err);
            }
          }

          if (!success) {
            console.warn('AudioWorklet failed, falling back to basic sound');
            this.useAudioWorklet = false;
            this.sound = new SpectrumSound();
            try {
              await this.sound.start();
            } catch (err) {
              console.warn('Basic sound also failed, continuing without audio:', err);
              this.sound.enabled = false;
            }
          }
        } catch (error) {
          console.warn('Audio initialization failed, continuing without audio:', error);
          this.sound.enabled = false;
        }
      } else {
        try {
          await this.sound.start();
        } catch (error) {
          console.warn('Sound start failed, continuing without audio:', error);
          this.sound.enabled = false;
        }
      }
    }

    this.running = true;
    this.lastFrameTime = performance.now();
    this.lastFpsUpdate = this.lastFrameTime;
    this.framesSinceLastFps = 0;

    // Start emulation loop
    this.emulationLoop();

    // Start render loop
    this._startRenderLoop();
  }

  /**
   * Stop the emulation
   */
  stop() {
    this.running = false;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.renderAnimationId) {
      cancelAnimationFrame(this.renderAnimationId);
      this.renderAnimationId = null;
    }

    if (this.sound && this.sound.stop) {
      this.sound.stop();
    }
  }

  /**
   * Main emulation loop - executes CPU cycles and manages timing
   *
   * @private
   * @returns {void}
   */
  emulationLoop() {
    if (!this.running) {
      this.animationId = null;
      return;
    }

    const now = performance.now();
    const deltaTime = this.lastFrameTime ? now - this.lastFrameTime : 0;
    this.lastFrameTime = now;

    this.accumulatedTime += deltaTime;

    const frameTime = 1000 / this.FRAMES_PER_SECOND;

    if (this.accumulatedTime >= frameTime) {
      this.runFrame();
      this.accumulatedTime -= frameTime;

      if (this.accumulatedTime > frameTime * 2) {
        this.accumulatedTime = 0;
      }
    }

    this.animationId = requestAnimationFrame(() => this.emulationLoop());
  }

  /**
   * Start the rendering loop
   *
   * @private
   * @returns {void}
   */
  _startRenderLoop() {
    const render = () => {
      if (!this.running) {
        this.renderAnimationId = null;
        return;
      }

      this.renderDisplay();
      this.draw();

      this.renderAnimationId = requestAnimationFrame(render);
    };

    render();
  }

  /**
   * Render the display from memory to pixel buffer
   *
   * @private
   * @returns {Uint8Array} Display buffer
   */
  renderDisplay() {
    const screenMemory = this.memory.getScreenMemory();
    const attributeMemory = this.memory.getAttributeMemory();
    const borderColor = this.ula.getBorderColor();

    const scanlineBorderColors = this.ula.getScanlineBorderColors();

    this.ula.resetBorderChanged();

    return this.display.render(screenMemory, attributeMemory, borderColor, scanlineBorderColors);
  }

  /**
   * Draw the display buffer to canvas
   *
   * @private
   * @param {HTMLCanvasElement} [canvas=null] - Target canvas (uses default if null)
   * @returns {void}
   */
  draw(canvas = null) {
    const targetCanvas = canvas || this.canvas;
    const ctx = canvas ? canvas.getContext('2d') : this.ctx;

    const imageData = this.display.getImageData();
    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Simulate a key press
   *
   * @param {string|KeyboardEvent} keyOrEvent - Key string or keyboard event
   */
  keyDown(keyOrEvent) {
    const key = typeof keyOrEvent === 'string' ? keyOrEvent : keyOrEvent.key;
    this._processKey(key, true);
  }

  /**
   * Simulate a key release
   *
   * @param {string|KeyboardEvent} keyOrEvent - Key string or keyboard event
   */
  keyUp(keyOrEvent) {
    const key = typeof keyOrEvent === 'string' ? keyOrEvent : keyOrEvent.key;
    this._processKey(key, false);
  }

  /**
   * Simulate a key press and release
   *
   * @param {string|KeyboardEvent} keyOrEvent - Key string or keyboard event
   * @param {number} [duration=50] - Duration of key press in milliseconds
   * @returns {Promise<void>}
   */
  async keyPress(keyOrEvent, duration = 50) {
    this.keyDown(keyOrEvent);
    await new Promise((resolve) => setTimeout(resolve, duration));
    this.keyUp(keyOrEvent);
  }

  /**
   * Type text automatically with realistic timing
   *
   * @param {string} text - Text to type
   * @param {Object} [options={}] - Typing options
   * @param {number} [options.keyDelay=100] - Delay between key presses in milliseconds
   * @param {number} [options.keyDuration=50] - Duration of each key press in milliseconds
   * @returns {Promise<void>}
   */
  async typeText(text, options = {}) {
    const { keyDelay = 100, keyDuration = 50 } = options;

    for (const char of text) {
      await this.keyPress(char, keyDuration);
      await new Promise((resolve) => setTimeout(resolve, keyDelay));
    }
  }

  /**
   * Load a snapshot from saved state data
   *
   * @param {Object} data - Snapshot data
   * @param {Uint8Array} [data.ram] - RAM contents
   * @param {Object} [data.cpu] - CPU state
   * @param {Object} [data.ula] - ULA state
   */
  loadSnapshot(data) {
    if (data.ram && data.ram.length === 49152) {
      this.memory.ram.set(data.ram);
    }

    if (data.cpu) {
      this.cpu.setState(data.cpu);
    }

    if (data.ula) {
      this.ula.borderColor = data.ula.borderColor ?? 7;
    }
  }

  /**
   * Load a Z80 snapshot file
   *
   * @param {ArrayBuffer|Uint8Array} data - Z80 snapshot data
   */
  loadZ80Snapshot(data) {
    const snapshotLoader = new Z80SnapshotLoader(this.memory, this.cpu, this.ula);
    snapshotLoader.load(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  }

  /**
   * Save current state as snapshot
   *
   * @returns {Object} Snapshot data with ram, cpu, and ula state
   */
  saveSnapshot() {
    return {
      ram: new Uint8Array(this.memory.ram),
      cpu: this.cpu.getState(),
      ula: {
        borderColor: this.ula.borderColor,
      },
    };
  }

  /**
   * Get emulator statistics
   *
   * @returns {Object} Statistics object
   * @returns {number} .fps - Current frames per second
   * @returns {number} .frameCount - Total frames rendered
   * @returns {Object} .cpuState - Current CPU state
   * @returns {boolean} .running - Whether emulator is running
   * @returns {Object} .audioStats - Audio statistics (if available)
   */
  getStats() {
    return {
      fps: this.fps,
      frameCount: this.frameCount,
      cpuState: this.cpu.getState(),
      running: this.running,
      audioStats: this.sound?.getStats ? this.sound.getStats() : null,
    };
  }

  /**
   * Write a byte to memory (POKE)
   *
   * @param {number} address - Memory address (0-65535)
   * @param {number} value - Value to write (0-255)
   * @returns {void}
   *
   * @example
   * spectrum.poke(23624, 0); // Clear keyboard buffer
   */
  poke(address, value) {
    this.memory.write(address, value);
  }

  /**
   * Read a byte from memory (PEEK)
   *
   * @param {number} address - Memory address (0-65535)
   * @returns {number} Byte value (0-255)
   *
   * @example
   * const borderColor = spectrum.peek(23624); // Read current border color
   */
  peek(address) {
    return this.memory.read(address);
  }

  /**
   * Enable or disable turbo mode
   *
   * @param {boolean} enabled - True to enable turbo mode
   * @returns {void}
   */
  setTurboMode(enabled) {
    this.turboMode = enabled;
  }

  /**
   * Load a TAP file for tape emulation
   *
   * @param {ArrayBuffer|Uint8Array} buffer - TAP file data
   * @param {string} [filename] - Optional filename for display
   */
  loadTape(buffer, filename) {
    this.tape.load(buffer, filename);
  }

  /**
   * Load a TAP file from URL
   *
   * @async
   * @param {string} url - URL to TAP file
   * @throws {Error} If tape loading fails
   */
  async loadTapeFromURL(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load tape: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const filename = url.split('/').pop();
      this.loadTape(arrayBuffer, filename);
    } catch (error) {
      throw new Error(`Error loading tape from URL: ${error.message}`);
    }
  }

  /**
   * Start tape playback
   */
  playTape() {
    this.tape.play();
  }

  /**
   * Pause tape playback
   */
  pauseTape() {
    this.tape.pause();
  }

  /**
   * Stop tape playback
   */
  stopTape() {
    this.tape.stop();
  }

  /**
   * Rewind tape to beginning
   */
  rewindTape() {
    this.tape.rewind();
  }

  /**
   * Get current tape status
   *
   * @returns {Object} Tape status
   * @returns {string} .status - Current status message
   * @returns {number} .position - Current position in tape
   * @returns {boolean} .playing - Whether tape is playing
   * @returns {boolean} .paused - Whether tape is paused
   */
  getTapeStatus() {
    return {
      status: this.tape.getStatus(),
      position: this.tape.getPosition(),
      playing: this.tape.playing,
      paused: this.tape.paused,
    };
  }

  /**
   * Set audio volume
   *
   * @param {number} volume - Volume level (0.0 to 1.0)
   * @returns {void}
   */
  setVolume(volume) {
    if (this.sound && this.sound.setVolume) {
      this.sound.setVolume(volume);
    }
  }

  /**
   * Mute or unmute audio
   *
   * @param {boolean} muted - True to mute, false to unmute
   * @returns {void}
   */
  setMuted(muted) {
    if (this.sound && this.sound.setMuted) {
      this.sound.setMuted(muted);
    }
  }

  /**
   * Enable or disable audio debug mode
   *
   * @param {boolean} enabled - True to enable debug mode
   * @returns {void}
   */
  setAudioDebugMode(enabled) {
    if (this.sound && this.sound.setDebugMode) {
      this.sound.setDebugMode(enabled);
    }
  }

  /**
   * Set custom key mapping
   *
   * @param {string} pcKey - PC keyboard key
   * @param {string|Object} spectrumKey - Spectrum key or key combination
   * @returns {void}
   *
   * @example
   * spectrum.setKeyMapping('Tab', 'CAPS_SHIFT');
   * spectrum.setKeyMapping('F1', { keys: ['CAPS_SHIFT', '1'] });
   */
  setKeyMapping(pcKey, spectrumKey) {
    this.customKeyMap[pcKey] = spectrumKey;
  }

  /**
   * Set multiple custom key mappings
   *
   * @param {Object} mappings - Object with PC key to Spectrum key mappings
   * @returns {void}
   *
   * @example
   * spectrum.setKeyMappings({
   *     'Tab': 'CAPS_SHIFT',
   *     'F1': { keys: ['CAPS_SHIFT', '1'] }
   * });
   */
  setKeyMappings(mappings) {
    Object.assign(this.customKeyMap, mappings);
  }

  /**
   * Clear all custom key mappings
   *
   * @returns {void}
   */
  clearCustomKeyMappings() {
    this.customKeyMap = {};
  }

  /**
   * Clean up and destroy the emulator instance
   *
   * Stops emulation, removes event listeners, and cleans up resources
   */
  destroy() {
    this.stop();

    // Remove keyboard handlers
    if (this.options.handleKeyboard && this._keyDownHandler) {
      document.removeEventListener('keydown', this._keyDownHandler);
      document.removeEventListener('keyup', this._keyUpHandler);
    }

    // Destroy touch keyboard
    if (this.touchKeyboard) {
      this.touchKeyboard.destroy();
      this.touchKeyboard = null;
    }

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export { SPECTRUM_KEYS, PC_KEY_MAP } from './ula.js';
