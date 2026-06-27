export const VIDEO_MODE_FAST = 'fast';
export const VIDEO_MODE_ACCURATE = 'accurateVideo';

export const VIDEO_PROFILE_48K_PAL = {
  id: '48k-pal',
  tstatesPerFrame: 69888,
  scanlinesPerFrame: 312,
  tstatesPerScanline: 224,
  screenWidth: 256,
  screenHeight: 192,
  borderTop: 48,
  borderBottom: 56,
  borderLeft: 48,
  borderRight: 48,
  displayedFirstScanline: 16,
  displayWindowStartTstate: 24,
  screenWindowStartTstate: 48,
  screenWindowEndTstate: 176,
};

const CONTENTION_PATTERN = [6, 5, 4, 3, 2, 1, 0, 0];

export function normalizeVideoMode(mode = VIDEO_MODE_FAST) {
  if (mode === VIDEO_MODE_FAST || mode === VIDEO_MODE_ACCURATE) {
    return mode;
  }
  throw new Error(`Unsupported videoMode: ${mode}`);
}

export function normalizeVideoProfile(profile = VIDEO_PROFILE_48K_PAL.id) {
  if (profile === VIDEO_PROFILE_48K_PAL.id) {
    return VIDEO_PROFILE_48K_PAL;
  }
  throw new Error(`Unsupported videoProfile: ${profile}`);
}

export function getScreenAddress(xByte, y) {
  const y7 = (y >> 7) & 0x01;
  const y6 = (y >> 6) & 0x01;
  const y5 = (y >> 5) & 0x01;
  const y4 = (y >> 4) & 0x01;
  const y3 = (y >> 3) & 0x01;
  const y2 = (y >> 2) & 0x01;
  const y1 = (y >> 1) & 0x01;
  const y0 = y & 0x01;

  return (y7 << 12) | (y6 << 11) | (y2 << 10) | (y1 << 9) | (y0 << 8) | (y5 << 7) | (y4 << 6) | (y3 << 5) | xByte;
}

export function getAttributeAddress(xByte, y) {
  return Math.floor(y / 8) * 32 + xByte;
}

export function frameTstateToBeam(tstate, profile = VIDEO_PROFILE_48K_PAL) {
  const frameTstate = ((Math.floor(tstate) % profile.tstatesPerFrame) + profile.tstatesPerFrame) % profile.tstatesPerFrame;
  return {
    frameTstate,
    scanline: Math.floor(frameTstate / profile.tstatesPerScanline),
    scanlineTstate: frameTstate % profile.tstatesPerScanline,
  };
}

export function displayYToScanline(y, profile = VIDEO_PROFILE_48K_PAL) {
  return (profile.displayedFirstScanline + y) % profile.scanlinesPerFrame;
}

export function displayXToScanlineTstate(x, profile = VIDEO_PROFILE_48K_PAL) {
  return profile.displayWindowStartTstate + Math.floor(x / 2);
}

export function displayPixelToFrameTstate(x, y, profile = VIDEO_PROFILE_48K_PAL) {
  const scanline = displayYToScanline(y, profile);
  return scanline * profile.tstatesPerScanline + displayXToScanlineTstate(x, profile);
}

export function bitmapByteBeamTstate(xByte, y, profile = VIDEO_PROFILE_48K_PAL) {
  const scanline = displayYToScanline(y + profile.borderTop, profile);
  return scanline * profile.tstatesPerScanline + profile.screenWindowStartTstate + xByte * 4;
}

export function isContendedAddress(address) {
  const addr = address & 0xffff;
  return addr >= 0x4000 && addr <= 0x7fff;
}

export function isActiveDisplayTstate(tstate, profile = VIDEO_PROFILE_48K_PAL) {
  const { scanline, scanlineTstate } = frameTstateToBeam(tstate, profile);
  return (
    scanline >= profile.displayedFirstScanline + profile.borderTop &&
    scanline < profile.displayedFirstScanline + profile.borderTop + profile.screenHeight &&
    scanlineTstate >= profile.screenWindowStartTstate &&
    scanlineTstate < profile.screenWindowEndTstate
  );
}

export function contentionDelayForTstate(tstate, profile = VIDEO_PROFILE_48K_PAL) {
  if (!isActiveDisplayTstate(tstate, profile)) {
    return 0;
  }
  return CONTENTION_PATTERN[frameTstateToBeam(tstate, profile).scanlineTstate & 0x07];
}

export function floatingBusAddressForTstate(tstate, profile = VIDEO_PROFILE_48K_PAL) {
  const { scanline, scanlineTstate } = frameTstateToBeam(tstate, profile);
  const screenScanline = scanline - (profile.displayedFirstScanline + profile.borderTop);
  if (
    screenScanline < 0 ||
    screenScanline >= profile.screenHeight ||
    scanlineTstate < profile.screenWindowStartTstate ||
    scanlineTstate >= profile.screenWindowEndTstate
  ) {
    return null;
  }

  const tstateIntoBitmap = scanlineTstate - profile.screenWindowStartTstate;
  const xByte = Math.floor(tstateIntoBitmap / 4);
  const phase = tstateIntoBitmap & 0x03;
  if (xByte < 0 || xByte >= 32 || phase > 1) {
    return null;
  }

  if (phase === 0) {
    return 0x4000 + getScreenAddress(xByte, screenScanline);
  }
  return 0x5800 + getAttributeAddress(xByte, screenScanline);
}
