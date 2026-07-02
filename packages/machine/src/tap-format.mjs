// Regenerated `.tap` tape-image codec, authored from the project DNA
// (dna/domain/file-formats.md "`.tap` — tape image (block stream)") and decided by
// the format conformance fixtures (dna/conformance/formats/tap-format.json). A `.tap`
// file is a flat concatenation of blocks with no header/footer/global length; each
// block is [len:2 LE][flag][data…][checksum], where len counts flag+data+checksum and
// checksum = XOR of the flag and every data byte (the 48K ROM tape parity byte). Tape,
// like a snapshot, is a file the machine loads, so this lives beside the .z80 codec.

// FMT-TAP-CHECKSUM-001: the XOR of the flag byte and every data byte.
export function tapChecksum(flag, data) {
  let checksum = flag & 0xff;
  for (let i = 0; i < data.length; i += 1) {
    checksum ^= data[i] & 0xff;
  }
  return checksum & 0xff;
}

// FMT-TAP-BLOCK-001 / FMT-TAP-LENGTH-001 / FMT-TAP-CHECKSUM-001: walk the file front to
// back. Each block = a 2-byte little-endian length L (flag + data + checksum), then L
// body bytes: flag, L-2 data bytes, checksum. The recomputed XOR over flag+data must
// equal the stored checksum, else the block is corrupt. Throws on a truncated block.
export function parseTap(bytes) {
  const file = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const blocks = [];
  let offset = 0;
  while (offset < file.length) {
    if (offset + 2 > file.length) {
      throw new Error(`parseTap: truncated length prefix at offset ${offset}`);
    }
    const length = file[offset] | (file[offset + 1] << 8); // little-endian
    const bodyStart = offset + 2;
    const bodyEnd = bodyStart + length;
    if (length < 2) {
      throw new Error(`parseTap: block at offset ${offset} has length ${length} < 2 (no room for flag + checksum)`);
    }
    if (bodyEnd > file.length) {
      throw new Error(`parseTap: block at offset ${offset} runs past end of file (need ${bodyEnd}, have ${file.length})`);
    }
    const flag = file[bodyStart];
    const data = file.slice(bodyStart + 1, bodyEnd - 1); // L-2 data bytes
    const checksum = file[bodyEnd - 1];
    const computed = tapChecksum(flag, data);
    if (computed !== checksum) {
      throw new Error(`parseTap: block at offset ${offset} checksum mismatch (stored 0x${checksum.toString(16)}, computed 0x${computed.toString(16)})`);
    }
    blocks.push({ flag, data, checksum });
    offset = bodyEnd;
  }
  return blocks;
}

// FMT-TAP-ROUNDTRIP-001: the exact inverse of parseTap. For each { flag, data }, emit
// [len LE][flag][data][checksum] with len = data.length + 2 and the checksum recomputed
// from flag+data; concatenate the blocks in order.
export function serializeTap(blocks) {
  let total = 0;
  for (const block of blocks) {
    total += 2 + 2 + block.data.length; // length prefix + flag + checksum + data
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const { flag, data } of blocks) {
    const length = data.length + 2; // flag + data + checksum
    out[offset] = length & 0xff; // little-endian low byte
    out[offset + 1] = (length >> 8) & 0xff; // high byte
    out[offset + 2] = flag & 0xff;
    for (let i = 0; i < data.length; i += 1) {
      out[offset + 3 + i] = data[i] & 0xff;
    }
    out[offset + 3 + data.length] = tapChecksum(flag, data);
    offset += 2 + length;
  }
  return out;
}
