// Regenerated `.tzx` tape-image codec, authored from the project DNA
// (dna/domain/file-formats.md "`.tzx` — tape image (versioned block stream)") and
// decided by the format conformance fixtures (dna/conformance/formats/tzx-format.json).
// A `.tzx` file is a 10-byte header ("ZXTape!" + 0x1A + major + minor) followed by a
// flat sequence of typed blocks, each introduced by a 1-byte block ID. Every multi-byte
// field is little-endian; the turbo (0x11) and pure-data (0x14) blocks carry a 3-byte
// length, NOT a 2-byte WORD. This slice models the nine common block IDs (0x10, 0x11,
// 0x12, 0x13, 0x14, 0x20, 0x21, 0x22, 0x30) against the pinned TZX v1.20 spec; an
// unsupported ID is rejected rather than skipped. Tape, like a snapshot, is a file the
// machine loads, so this lives beside the .tap/.z80 codecs.

// FMT-TZX-HEADER-001: the 7 ASCII signature bytes (the 0x1A end-of-text marker is
// separate) and the pinned v1.20.
export const TZX_SIGNATURE = "ZXTape!";
export const TZX_VERSION = { major: 1, minor: 20 };

const SIGNATURE_BYTES = Uint8Array.from([0x5a, 0x58, 0x54, 0x61, 0x70, 0x65, 0x21]); // "ZXTape!"
const EOT_MARKER = 0x1a;
const HEADER_LENGTH = 10; // 7 signature + 1 marker + 1 major + 1 minor

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value);
  return Uint8Array.from(value ?? []);
}

// FMT-TZX-TEXT-0x30-001 / FMT-TZX-GROUP-0x21-0x22-001: group name / text are ASCII
// (Latin-1) strings. Decode/encode byte-for-byte so any 0x00..0xFF round-trips.
function bytesToLatin1(bytes, start, length) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[start + i] & 0xff);
  return out;
}
function latin1ToBytes(text) {
  const str = String(text ?? "");
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

// A small front-to-back reader over a Uint8Array. Throws if a read runs past the end —
// this is how a truncated block is rejected (FMT-TZX-BLOCK-STREAM-001).
class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }
  remaining() {
    return this.bytes.length - this.offset;
  }
  need(n, what) {
    if (this.offset + n > this.bytes.length) {
      throw new Error(`parseTzx: truncated ${what} at offset ${this.offset} (need ${n}, have ${this.remaining()})`);
    }
  }
  u8(what) {
    this.need(1, what);
    return this.bytes[this.offset++] & 0xff;
  }
  u16(what) {
    // FMT-TZX-ENDIAN-001: little-endian WORD.
    this.need(2, what);
    const v = this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8);
    this.offset += 2;
    return v & 0xffff;
  }
  u24(what) {
    // FMT-TZX-ENDIAN-001: 3-byte little-endian length (turbo/pure-data).
    this.need(3, what);
    const v =
      this.bytes[this.offset] |
      (this.bytes[this.offset + 1] << 8) |
      (this.bytes[this.offset + 2] << 16);
    this.offset += 3;
    return v >>> 0;
  }
  take(n, what) {
    this.need(n, what);
    const slice = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }
}

// Per-ID block-body readers. Each returns the structured block; the reader's offset is
// advanced exactly past the block body, so the caller resumes at the next block ID.
const BLOCK_READERS = {
  // FMT-TZX-DATA-0x10-001: pause (WORD), length (WORD), data.
  0x10(r) {
    const pause = r.u16("0x10 pause");
    const length = r.u16("0x10 length");
    const data = r.take(length, "0x10 data");
    return { id: 0x10, pause, data };
  },
  // FMT-TZX-TURBO-0x11-001: 18-byte fixed header, then a 3-BYTE length, then data.
  0x11(r) {
    const pilot = r.u16("0x11 pilot");
    const sync1 = r.u16("0x11 sync1");
    const sync2 = r.u16("0x11 sync2");
    const zero = r.u16("0x11 zero");
    const one = r.u16("0x11 one");
    const pilotPulses = r.u16("0x11 pilotPulses");
    const usedBits = r.u8("0x11 usedBits");
    const pause = r.u16("0x11 pause");
    const length = r.u24("0x11 length");
    const data = r.take(length, "0x11 data");
    return { id: 0x11, pilot, sync1, sync2, zero, one, pilotPulses, usedBits, pause, data };
  },
  // FMT-TZX-TONE-0x12-001: pulse length (WORD), pulse count (WORD); no data.
  0x12(r) {
    const pulseLength = r.u16("0x12 pulseLength");
    const pulseCount = r.u16("0x12 pulseCount");
    return { id: 0x12, pulseLength, pulseCount };
  },
  // FMT-TZX-PULSES-0x13-001: count (BYTE), then count little-endian WORD pulse lengths.
  0x13(r) {
    const count = r.u8("0x13 count");
    const pulses = [];
    for (let i = 0; i < count; i += 1) pulses.push(r.u16(`0x13 pulse[${i}]`));
    return { id: 0x13, pulses };
  },
  // FMT-TZX-PUREDATA-0x14-001: 10-byte fixed header, then a 3-BYTE length, then data.
  0x14(r) {
    const zero = r.u16("0x14 zero");
    const one = r.u16("0x14 one");
    const usedBits = r.u8("0x14 usedBits");
    const pause = r.u16("0x14 pause");
    const length = r.u24("0x14 length");
    const data = r.take(length, "0x14 data");
    return { id: 0x14, zero, one, usedBits, pause, data };
  },
  // FMT-TZX-PAUSE-0x20-001: pause duration (WORD); 0 = stop the tape.
  0x20(r) {
    const pause = r.u16("0x20 pause");
    return { id: 0x20, pause };
  },
  // FMT-TZX-GROUP-0x21-0x22-001: name length (BYTE), then ASCII name.
  0x21(r) {
    const length = r.u8("0x21 name length");
    const bytes = r.take(length, "0x21 name");
    return { id: 0x21, name: bytesToLatin1(bytes, 0, bytes.length) };
  },
  // FMT-TZX-GROUP-0x21-0x22-001: group end, no body.
  0x22() {
    return { id: 0x22 };
  },
  // FMT-TZX-TEXT-0x30-001: text length (BYTE), then ASCII text.
  0x30(r) {
    const length = r.u8("0x30 text length");
    const bytes = r.take(length, "0x30 text");
    return { id: 0x30, text: bytesToLatin1(bytes, 0, bytes.length) };
  },
};

// FMT-TZX-HEADER-001 / FMT-TZX-BLOCK-STREAM-001: validate the header, then walk blocks.
export function parseTzx(bytes) {
  const file = toBytes(bytes);
  if (file.length < HEADER_LENGTH) {
    throw new Error(`parseTzx: file too short for a TZX header (${file.length} < ${HEADER_LENGTH})`);
  }
  for (let i = 0; i < SIGNATURE_BYTES.length; i += 1) {
    if ((file[i] & 0xff) !== SIGNATURE_BYTES[i]) {
      throw new Error('parseTzx: bad signature (expected "ZXTape!")');
    }
  }
  if ((file[7] & 0xff) !== EOT_MARKER) {
    throw new Error("parseTzx: missing 0x1A end-of-text marker after signature");
  }
  const version = { major: file[8] & 0xff, minor: file[9] & 0xff };

  const r = new Reader(file);
  r.offset = HEADER_LENGTH;
  const blocks = [];
  while (r.remaining() > 0) {
    const id = r.u8("block id");
    const read = BLOCK_READERS[id];
    if (!read) {
      throw new Error(`parseTzx: unsupported block id 0x${id.toString(16)} at offset ${r.offset - 1}`);
    }
    blocks.push(read(r));
  }
  return { version, blocks };
}

// Per-ID block-body writers, the exact inverse of BLOCK_READERS. Each pushes the body
// bytes (no leading ID) onto `out`.
function pushU16(out, value) {
  out.push(value & 0xff, (value >> 8) & 0xff);
}
function pushU24(out, value) {
  out.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);
}

const BLOCK_WRITERS = {
  0x10(out, b) {
    const data = toBytes(b.data);
    pushU16(out, b.pause ?? 0);
    pushU16(out, data.length);
    for (const byte of data) out.push(byte & 0xff);
  },
  0x11(out, b) {
    const data = toBytes(b.data);
    pushU16(out, b.pilot ?? 0);
    pushU16(out, b.sync1 ?? 0);
    pushU16(out, b.sync2 ?? 0);
    pushU16(out, b.zero ?? 0);
    pushU16(out, b.one ?? 0);
    pushU16(out, b.pilotPulses ?? 0);
    out.push((b.usedBits ?? 0) & 0xff);
    pushU16(out, b.pause ?? 0);
    pushU24(out, data.length);
    for (const byte of data) out.push(byte & 0xff);
  },
  0x12(out, b) {
    pushU16(out, b.pulseLength ?? 0);
    pushU16(out, b.pulseCount ?? 0);
  },
  0x13(out, b) {
    const pulses = b.pulses ?? [];
    out.push(pulses.length & 0xff);
    for (const p of pulses) pushU16(out, p);
  },
  0x14(out, b) {
    const data = toBytes(b.data);
    pushU16(out, b.zero ?? 0);
    pushU16(out, b.one ?? 0);
    out.push((b.usedBits ?? 0) & 0xff);
    pushU16(out, b.pause ?? 0);
    pushU24(out, data.length);
    for (const byte of data) out.push(byte & 0xff);
  },
  0x20(out, b) {
    pushU16(out, b.pause ?? 0);
  },
  0x21(out, b) {
    const name = latin1ToBytes(b.name);
    out.push(name.length & 0xff);
    for (const byte of name) out.push(byte & 0xff);
  },
  0x22() {
    // no body
  },
  0x30(out, b) {
    const text = latin1ToBytes(b.text);
    out.push(text.length & 0xff);
    for (const byte of text) out.push(byte & 0xff);
  },
};

// FMT-TZX-ROUNDTRIP-001: emit the 10-byte header, then each block as [id][body].
export function serializeTzx(tzx) {
  const version = tzx?.version ?? TZX_VERSION;
  const blocks = tzx?.blocks ?? [];
  const out = [];
  for (const byte of SIGNATURE_BYTES) out.push(byte);
  out.push(EOT_MARKER);
  out.push((version.major ?? TZX_VERSION.major) & 0xff);
  out.push((version.minor ?? TZX_VERSION.minor) & 0xff);
  for (const block of blocks) {
    const write = BLOCK_WRITERS[block.id];
    if (!write) {
      throw new Error(`serializeTzx: unsupported block id 0x${(block.id ?? -1).toString(16)}`);
    }
    out.push(block.id & 0xff);
    write(out, block);
  }
  return Uint8Array.from(out);
}
