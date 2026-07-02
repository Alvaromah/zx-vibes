#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  adapterUsage,
  parseAdapterArgs,
  runExternalAdapter,
} from "../external-adapter-protocol.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(thisDir, "..");
const defaultSuite = "zexdoc";
const referenceEnvName = "ZX_VIBES_CPU_REFERENCE";

function usage() {
  return adapterUsage({
    command: "dna/conformance/cpu/run-zex.mjs",
    defaultSuite,
    referenceEnvName,
    description: "Runs a pinned zexdoc/zexall manifest through a CPU reference adapter.",
  });
}

export async function runZex(argv = process.argv.slice(2)) {
  const options = parseAdapterArgs(argv, { defaultRoot, defaultSuite, referenceEnvName });
  if (options.help) {
    console.log(usage());
    return { exitCode: 0 };
  }

  return runExternalAdapter({
    root: options.root,
    suite: options.suite,
    kind: "cpu-zex",
    reference: options.reference,
    referenceEnvName,
    timeoutMs: options.timeoutMs,
    payloadCache: options.payloadCache,
    resolvePayloads: options.resolvePayloads,
    json: options.json,
    quiet: options.quiet,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runZex()
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
