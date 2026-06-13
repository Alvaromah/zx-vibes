// Jest setup file for ZXGeneration tests

// Mock AudioContext for Web Audio API tests
global.AudioContext = jest.fn().mockImplementation(() => ({
  createGain: jest.fn(() => ({
    gain: { value: 1 },
    connect: jest.fn(),
  })),
  createScriptProcessor: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
  })),
  createBuffer: jest.fn(),
  createBufferSource: jest.fn(() => ({
    buffer: null,
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  })),
  destination: {},
  sampleRate: 44100,
}));

// Mock AudioWorklet
global.AudioWorkletNode = jest.fn();

// Mock Canvas API (only under jsdom — node-environment test files have no DOM)
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = jest.fn().mockImplementation((type) => {
  if (type === '2d') {
    return {
      createImageData: jest.fn(() => ({
        data: new Uint8ClampedArray(256 * 192 * 4),
        width: 256,
        height: 192,
      })),
      putImageData: jest.fn(),
      fillRect: jest.fn(),
      fillStyle: '',
      };
    }
    return null;
  });
}

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn((cb) => {
  setTimeout(cb, 16); // Simulate 60fps
  return 1;
});

// Mock performance.now()
global.performance = {
  now: jest.fn(() => Date.now()),
};

// Suppress console errors during tests unless explicitly needed
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});