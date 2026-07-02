import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const profilePath = path.join(thisDir, "profiles", "deterministic-run.json");

export const DETERMINISTIC_PROFILE = Object.freeze(
  JSON.parse(readFileSync(profilePath, "utf8")),
);

export function createDeterministicEnv(baseEnv = process.env, profile = DETERMINISTIC_PROFILE) {
  return {
    ...baseEnv,
    ...profile.environment,
    ZX_VIBES_CONFORMANCE: "1",
    ZX_VIBES_RNG_SEED: profile.machine.rngSeed,
    ZX_VIBES_FRAME_COUNT: String(profile.machine.frameCount),
    ZX_VIBES_TSTATES: String(profile.machine.totalTStates),
  };
}

export function createDeterministicRunOptions({
  baseEnv = process.env,
  profile = DETERMINISTIC_PROFILE,
} = {}) {
  return {
    env: createDeterministicEnv(baseEnv, profile),
    profile: profile.id,
    rngSeed: profile.machine.rngSeed,
    frameCount: profile.machine.frameCount,
    tStates: profile.machine.totalTStates,
    tStatesPerFrame: profile.machine.tStatesPerFrame,
  };
}
