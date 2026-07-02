#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  createDeterministicEnv,
  createDeterministicRunOptions,
} from "./determinism.mjs";
import { normalizeCliSnapshot } from "./normalization.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const deterministicEnv = createDeterministicEnv({
  TZ: "Europe/Madrid",
  LC_ALL: "es_ES.UTF-8",
  FORCE_COLOR: "1",
});

assert(deterministicEnv.TZ === "UTC", "deterministic env must force TZ=UTC");
assert(deterministicEnv.LC_ALL === "C", "deterministic env must force LC_ALL=C");
assert(deterministicEnv.FORCE_COLOR === "0", "deterministic env must disable color");
assert(deterministicEnv.NO_COLOR === "1", "deterministic env must set NO_COLOR=1");
assert(
  deterministicEnv.ZX_VIBES_RNG_SEED === "0x5A78564D",
  "deterministic env must expose a fixed RNG seed",
);

const runOptions = createDeterministicRunOptions({ baseEnv: deterministicEnv });
assert(runOptions.frameCount === 2, "deterministic run must fix frame count");
assert(runOptions.tStates === 139776, "deterministic run must fix total T-states");

const envProbe = spawnSync(
  process.execPath,
  [
    "-e",
    "process.stdout.write(JSON.stringify({tz:process.env.TZ,lc:process.env.LC_ALL,seed:process.env.ZX_VIBES_RNG_SEED}))",
  ],
  { encoding: "utf8", env: deterministicEnv },
);
assert(envProbe.status === 0, "deterministic env probe should run");
assert(
  envProbe.stdout === '{"tz":"UTC","lc":"C","seed":"0x5A78564D"}',
  "child process should receive deterministic env",
);

const noisyA = [
  "zx-vibes 0.2.1",
  "cwd: C:\\Users\\alice\\AppData\\Local\\Temp\\zx-vibes-a\\project",
  "source: /tmp/zx-vibes-a/project/src/main.asm",
  "started: 2026-06-27T11:22:33.456Z",
  "preview: http://127.0.0.1:5173/index.html",
  "port: 5173",
  "commit: abcdef1234567890abcdef1234567890abcdef12",
].join("\r\n");

const noisyB = [
  "zx-vibes 9.8.7-beta.1",
  "cwd: D:\\Builds\\Temp\\zx-vibes-b\\project",
  "source: /var/folders/zx-vibes-b/project/src/main.asm",
  "started: 2031-01-02T03:04:05.999+00:00",
  "preview: http://127.0.0.1:62001/index.html",
  "port: 62001",
  "commit: deadbeef1234567890abcdef1234567890abcdef",
].join("\n");

const normalizedA = normalizeCliSnapshot(noisyA);
const normalizedB = normalizeCliSnapshot(noisyB);
const repeatA = normalizeCliSnapshot(noisyA);
assert(normalizedA === normalizedB, "normalized CLI snapshots must be byte-identical");
assert(normalizedA === repeatA, "the same CLI snapshot input must normalize identically twice");
assert(
  Buffer.compare(Buffer.from(normalizedA, "utf8"), Buffer.from(normalizedB, "utf8")) === 0,
  "normalized CLI snapshots must compare equal as bytes",
);
assert(
  Buffer.compare(Buffer.from(normalizedA, "utf8"), Buffer.from(repeatA, "utf8")) === 0,
  "repeated normalization of the same input must compare equal as bytes",
);
assert(normalizedA.includes("<VERSION>"), "version strings must be normalized");
assert(normalizedA.includes("<PATH>"), "absolute paths must be normalized");
assert(normalizedA.includes("<TIMESTAMP>"), "timestamps must be normalized");
assert(normalizedA.includes("<PORT>"), "ports must be normalized");
assert(normalizedA.includes("<HASH>"), "hashes must be normalized");

console.log(
  "Normalization self-test passed: deterministic env fixed; noisy CLI output normalizes to identical bytes.",
);
