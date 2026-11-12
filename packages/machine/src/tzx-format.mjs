// Regenerated `.tzx` tape-image codec, authored from the project DNA
// (dna/domain/file-formats.md "`.tzx` — tape image (versioned block stream)") and
// decided by the format conformance fixtures (dna/conformance/formats/tzx-format.json).
// A `.tzx` file is a 10-byte header ("ZXTape!" + 0x1A + major + minor) followed by a
// flat sequence of typed blocks, each introduced by a 1-byte block ID. Every multi-byte
// field is little-endian; the turbo (0x11) and pure-data (0x14) blocks carry a 3-byte
// length, NOT a 2-byte WORD. Modeled against the pinned TZX v1.20 spec: the data/signal
// blocks 0x10-0x14 and 0x20, the control blocks 0x23-0x28, 0x2A and 0x2B
// (FMT-TZX-CONTROL-001), and the informational blocks 0x21, 0x22, 0x30-0x33, 0x35 and
// 0x5A (FMT-TZX-INFO-001). Any other ID — including the signal blocks 0x15/0x18/0x19,
// which this codec does not decode — is rejected rather than skipped. Tape, like a
// snapshot, is a file the machine loads, so this lives beside the .tap/.z80 codecs.

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
  s16(what) {
    const v = this.u16(what);
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  u32(what) {
    // FMT-TZX-ENDIAN-001: little-endian DWORD (the v1.10+ extension-rule length).
    this.need(4, what);
    const b = this.bytes;
    const v = (b[this.offset] | (b[this.offset + 1] << 8) | (b[this.offset + 2] << 16)) + b[this.offset + 3] * 0x1000000;
    this.offset += 4;
    return v;
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
  // FMT-TZX-CONTROL-001: jump to block, a signed relative block offset (WORD).
  0x23(r) {
    return { id: 0x23, offset: r.s16("0x23 offset") };
  },
  // FMT-TZX-CONTROL-001: loop start (repetitions, WORD) / loop end (no body).
  0x24(r) {
    return { id: 0x24, count: r.u16("0x24 count") };
  },
  0x25() {
    return { id: 0x25 };
  },
  // FMT-TZX-CONTROL-001: call sequence (count WORD, then signed WORD offsets) / return.
  0x26(r) {
    const count = r.u16("0x26 count");
    const offsets = [];
    for (let i = 0; i < count; i += 1) offsets.push(r.s16(`0x26 offset[${i}]`));
    return { id: 0x26, offsets };
  },
  0x27() {
    return { id: 0x27 };
  },
  // FMT-TZX-CONTROL-001: select block — WORD length of the rest, BYTE count, then per
  // entry a signed WORD offset, BYTE length and the description text.
  0x28(r) {
    const length = r.u16("0x28 length");
    const body = new Reader(r.take(length, "0x28 body"));
    const count = body.u8("0x28 count");
    const entries = [];
    for (let i = 0; i < count; i += 1) {
      const offset = body.s16(`0x28 entry[${i}] offset`);
      const text = body.take(body.u8(`0x28 entry[${i}] length`), `0x28 entry[${i}] text`);
      entries.push({ offset, description: bytesToLatin1(text, 0, text.length) });
    }
    if (body.remaining() !== 0) throw new Error(`parseTzx: 0x28 length ${length} does not match its entries`);
    return { id: 0x28, entries };
  },
  // FMT-TZX-CONTROL-001: stop the tape if in 48K mode — a DWORD length (0) and no body.
  0x2a(r) {
    const length = r.u32("0x2a length");
    r.take(length, "0x2a body");
    return { id: 0x2a };
  },
  // FMT-TZX-CONTROL-001: set signal level — a DWORD length (1), then the level byte.
  0x2b(r) {
    const length = r.u32("0x2b length");
    const body = r.take(length, "0x2b body");
    if (length < 1) throw new Error("parseTzx: 0x2b body has no signal level");
    return { id: 0x2b, level: body[0] & 0xff };
  },
  // FMT-TZX-INFO-001: message — display time (BYTE, seconds), length (BYTE), text.
  0x31(r) {
    const time = r.u8("0x31 time");
    const bytes = r.take(r.u8("0x31 length"), "0x31 text");
    return { id: 0x31, time, text: bytesToLatin1(bytes, 0, bytes.length) };
  },
  // FMT-TZX-INFO-001: archive info — WORD length of the rest, BYTE count, then per entry
  // a type byte, a length byte and the text.
  0x32(r) {
    const length = r.u16("0x32 length");
    const body = new Reader(r.take(length, "0x32 body"));
    const count = body.u8("0x32 count");
    const entries = [];
    for (let i = 0; i < count; i += 1) {
      const type = body.u8(`0x32 entry[${i}] type`);
      const text = body.take(body.u8(`0x32 entry[${i}] length`), `0x32 entry[${i}] text`);
      entries.push({ type, text: bytesToLatin1(text, 0, text.length) });
    }
    if (body.remaining() !== 0) throw new Error(`parseTzx: 0x32 length ${length} does not match its entries`);
    return { id: 0x32, entries };
  },
  // FMT-TZX-INFO-001: hardware type — a count byte, then 3 bytes per entry.
  0x33(r) {
    const count = r.u8("0x33 count");
    const entries = [];
    for (let i = 0; i < count; i += 1) {
      entries.push({ type: r.u8(`0x33 entry[${i}] type`), hardwareId: r.u8(`0x33 entry[${i}] id`), info: r.u8(`0x33 entry[${i}] info`) });
    }
    return { id: 0x33, entries };
  },
  // FMT-TZX-INFO-001: custom info — a 16-character identification (the spec's CHAR[10] is
  // hex, like all its sizes and offsets), a DWORD length at offset 0x10, then the bytes.
  0x35(r) {
    const ident = r.take(16, "0x35 identification");
    const info = r.take(r.u32("0x35 length"), "0x35 info");
    return { id: 0x35, ident: bytesToLatin1(ident, 0, 16), info };
  },
  // FMT-TZX-INFO-001: "glue" — the 9-byte header of a concatenated TZX file.
  0x5a(r) {
    return { id: 0x5a, glue: r.take(9, "0x5a glue") };
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
function pushU32(out, value) {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
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
  0x23(out, b) {
    pushU16(out, b.offset ?? 0);
  },
  0x24(out, b) {
    pushU16(out, b.count ?? 0);
  },
  0x25() {
    // no body
  },
  0x26(out, b) {
    const offsets = b.offsets ?? [];
    pushU16(out, offsets.length);
    for (const offset of offsets) pushU16(out, offset);
  },
  0x27() {
    // no body
  },
  0x28(out, b) {
    const body = [];
    const entries = b.entries ?? [];
    body.push(entries.length & 0xff);
    for (const entry of entries) {
      const text = latin1ToBytes(entry.description);
      pushU16(body, entry.offset ?? 0);
      body.push(text.length & 0xff);
      for (const byte of text) body.push(byte & 0xff);
    }
    pushU16(out, body.length);
    out.push(...body);
  },
  0x2a(out) {
    pushU32(out, 0);
  },
  0x2b(out, b) {
    pushU32(out, 1);
    out.push((b.level ?? 0) & 0xff);
  },
  0x31(out, b) {
    const text = latin1ToBytes(b.text);
    out.push((b.time ?? 0) & 0xff, text.length & 0xff);
    for (const byte of text) out.push(byte & 0xff);
  },
  0x32(out, b) {
    const body = [];
    const entries = b.entries ?? [];
    body.push(entries.length & 0xff);
    for (const entry of entries) {
      const text = latin1ToBytes(entry.text);
      body.push((entry.type ?? 0) & 0xff, text.length & 0xff);
      for (const byte of text) body.push(byte & 0xff);
    }
    pushU16(out, body.length);
    out.push(...body);
  },
  0x33(out, b) {
    const entries = b.entries ?? [];
    out.push(entries.length & 0xff);
    for (const entry of entries) out.push((entry.type ?? 0) & 0xff, (entry.hardwareId ?? 0) & 0xff, (entry.info ?? 0) & 0xff);
  },
  0x35(out, b) {
    const ident = latin1ToBytes(String(b.ident ?? "").padEnd(16, " ").slice(0, 16));
    const info = toBytes(b.info);
    for (const byte of ident) out.push(byte & 0xff);
    pushU32(out, info.length);
    for (const byte of info) out.push(byte & 0xff);
  },
  0x5a(out, b) {
    const glue = toBytes(b.glue);
    for (let i = 0; i < 9; i += 1) out.push((glue[i] ?? 0) & 0xff);
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
