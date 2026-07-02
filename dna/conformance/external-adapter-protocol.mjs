import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { checkExternalSuites } from "./external-suites.mjs";
import { resolveExternalPayloads } from "./external-payloads.mjs";

const PROTOCOL_VERSION = "zx-vibes.external-suite.v1";
const ADAPTER_STATUS = new Set(["pass", "fail", "not_run", "error"]);

export function parseAdapterArgs(argv, { defaultRoot, defaultSuite, referenceEnvName }) {
  const options = {
    root: defaultRoot,
    suite: defaultSuite,
    reference: process.env[referenceEnvName] ?? null,
    json: false,
    quiet: false,
    timeoutMs: 30000,
    payloadCache: path.resolve(defaultRoot, "..", "..", ".cache", "external-suites"),
    resolvePayloads: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--root requires a path");
      }
      options.root = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--suite") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--suite requires a suite id");
      }
      options.suite = value;
      index += 1;
      continue;
    }
    if (arg === "--reference") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--reference requires a command");
      }
      options.reference = value;
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--timeout-ms requires a positive integer");
      }
      options.timeoutMs = value;
      index += 1;
      continue;
    }
    if (arg === "--payload-cache") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--payload-cache requires a path");
      }
      options.payloadCache = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--resolve-payloads") {
      options.resolvePayloads = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

export function adapterUsage({ command, defaultSuite, referenceEnvName, description }) {
  return [
    `Usage: node ${command} [--suite <suite>] [--reference <command>] [--resolve-payloads] [--json] [--quiet]`,
    "",
    description,
    "",
    `Default suite: ${defaultSuite}`,
    `Reference adapter env fallback: ${referenceEnvName}`,
    "",
    "Exit codes: 0 pass, 1 suite failure, 2 not runnable or adapter error.",
    "The reference adapter receives a JSON request on stdin and returns JSON on stdout.",
  ].join("\n");
}

async function collectManifestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectManifestFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".manifest.json")) {
      files.push(entryPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function loadManifest(root, suite) {
  const files = await collectManifestFiles(path.join(root, "external"));

  for (const file of files) {
    const manifest = JSON.parse(await readFile(file, "utf8"));
    if (manifest.suite === suite) {
      return { manifest, file };
    }
  }

  throw new Error(`external suite manifest not found for '${suite}'`);
}

function buildRequest({ kind, suite, manifest, payloads = null }) {
  return {
    protocol: PROTOCOL_VERSION,
    kind,
    suite,
    manifest: {
      id: manifest.id,
      provenance: manifest.provenance,
      source: manifest.source,
      execution: manifest.execution,
    },
    payloads,
    expected: {
      status: "pass",
    },
  };
}

function normalizeAdapterReport(value) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("adapter stdout must be a JSON object");
  }
  if (!ADAPTER_STATUS.has(value.status)) {
    throw new Error("adapter report status must be pass, fail, not_run, or error");
  }
  return {
    status: value.status,
    tests: Number.isInteger(value.tests) ? value.tests : null,
    failures: Number.isInteger(value.failures) ? value.failures : null,
    message: typeof value.message === "string" ? value.message : "",
    details: value.details ?? null,
  };
}

function parseAdapterStdout(stdout) {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    throw new Error("adapter produced no JSON on stdout");
  }
  return normalizeAdapterReport(JSON.parse(trimmed));
}

function exitCodeForStatus(status) {
  if (status === "pass") {
    return 0;
  }
  if (status === "fail") {
    return 1;
  }
  return 2;
}

function reportLine(report) {
  const upper = report.status.toUpperCase();
  const tests = report.tests === null ? "" : ` tests=${report.tests}`;
  const failures = report.failures === null ? "" : ` failures=${report.failures}`;
  const message = report.message ? ` ${report.message}` : "";
  return `${upper} ${report.id} ${report.suite}${tests}${failures}${message}`;
}

function notRunReport({ suite, kind, referenceEnvName }) {
  return {
    id: `NOT-RUN-${suite.toUpperCase()}`,
    suite,
    kind,
    status: "not_run",
    tests: null,
    failures: null,
    message: `configure --reference or ${referenceEnvName}`,
    details: null,
    exitCode: 2,
  };
}

function errorReport({ suite, kind, id = `ERROR-${suite.toUpperCase()}`, message, details = null }) {
  return {
    id,
    suite,
    kind,
    status: "error",
    tests: null,
    failures: null,
    message,
    details,
    exitCode: 2,
  };
}

export async function runExternalAdapter({
  root,
  suite,
  kind,
  reference,
  referenceEnvName,
  timeoutMs,
  payloadCache,
  resolvePayloads = false,
  json = false,
  quiet = false,
} = {}) {
  let report;

  if (!reference) {
    report = notRunReport({ suite, kind, referenceEnvName });
    emitReport(report, { json, quiet });
    return report;
  }

  const manifestCheck = await checkExternalSuites({ root, quiet: true });
  if (!manifestCheck.ok) {
    report = errorReport({
      suite,
      kind,
      message: "external suite manifests failed validation",
    });
    emitReport(report, { json, quiet });
    return report;
  }

  let manifest;
  try {
    ({ manifest } = await loadManifest(root, suite));
  } catch (error) {
    report = errorReport({
      suite,
      kind,
      message: error instanceof Error ? error.message : String(error),
    });
    emitReport(report, { json, quiet });
    return report;
  }

  let payloads = null;
  if (resolvePayloads) {
    const payloadResult = await resolveExternalPayloads({
      root,
      cache: payloadCache,
      suite,
      quiet: true,
    });
    if (!payloadResult.ok) {
      report = errorReport({
        suite,
        kind,
        id: manifest.id,
        message: "external suite payload resolution failed",
        details: payloadResult.errors,
      });
      emitReport(report, { json, quiet });
      return report;
    }
    payloads = payloadResult.artifacts.map((artifact) => ({
      path: artifact.path,
      localPath: artifact.localPath,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    }));
  }

  const request = buildRequest({ kind, suite, manifest, payloads });
  const child = spawnSync(reference, {
    shell: true,
    input: JSON.stringify(request),
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
      ...process.env,
      ZX_VIBES_EXTERNAL_SUITE_PROTOCOL: PROTOCOL_VERSION,
    },
  });

  if (child.error) {
    report = errorReport({
      suite,
      kind,
      id: manifest.id,
      message: child.error.message,
    });
    emitReport(report, { json, quiet });
    return report;
  }

  let adapterReport;
  try {
    adapterReport = parseAdapterStdout(child.stdout ?? "");
  } catch (error) {
    report = errorReport({
      suite,
      kind,
      id: manifest.id,
      message: error instanceof Error ? error.message : String(error),
      details: {
        adapterStatus: child.status,
        stderr: child.stderr?.trim() || null,
      },
    });
    emitReport(report, { json, quiet });
    return report;
  }

  const status =
    adapterReport.status === "pass" && child.status !== 0 ? "error" : adapterReport.status;
  report = {
    id: manifest.id,
    suite,
    kind,
    status,
    tests: adapterReport.tests,
    failures: adapterReport.failures,
    message:
      status === "error" && adapterReport.status === "pass"
        ? `adapter exited ${child.status} after reporting pass`
        : adapterReport.message,
    details: adapterReport.details,
    exitCode: exitCodeForStatus(status),
  };
  emitReport(report, { json, quiet });
  return report;
}

export function emitReport(report, { json = false, quiet = false } = {}) {
  if (quiet) {
    return;
  }
  if (json) {
    console.log(
      JSON.stringify(
        {
          id: report.id,
          suite: report.suite,
          kind: report.kind,
          status: report.status,
          tests: report.tests,
          failures: report.failures,
          message: report.message,
          details: report.details,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(reportLine(report));
}
