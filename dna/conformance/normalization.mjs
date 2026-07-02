#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function pathVariants(value) {
  const normalized = path.resolve(value);
  return unique([
    normalized,
    normalized.replaceAll("\\", "/"),
    normalized.replaceAll("/", "\\"),
  ]);
}

function replaceKnownPaths(output, paths) {
  const variants = unique(paths.flatMap(pathVariants)).sort((a, b) => b.length - a.length);
  let normalized = output;

  for (const variant of variants) {
    normalized = normalized.replace(new RegExp(escapeRegExp(variant), "g"), "<PATH>");
  }

  return normalized;
}

export function normalizeCliSnapshot(input, options = {}) {
  const knownPaths = unique([
    process.cwd(),
    os.tmpdir(),
    ...(options.paths ?? []),
    ...(options.tempDirs ?? []),
  ]);

  let output = String(input);

  output = output.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  output = replaceKnownPaths(output, knownPaths);

  output = output.replace(
    /\b\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-][0-2]\d:?[0-5]\d)?\b/g,
    "<TIMESTAMP>",
  );
  output = output.replace(
    /\b((?:build|commit|hash|revision|sha)\s*(?::|=|\s)\s*)[a-f0-9]{7,64}\b/gi,
    "$1<HASH>",
  );
  output = output.replace(/\b[a-f0-9]{40,64}\b/gi, "<HASH>");
  output = output.replace(/\b(localhost|127\.0\.0\.1|\[::1\]):\d{2,5}\b/g, "$1:<PORT>");
  output = output.replace(/\b(port)\s*(?::|=|\s)\s*\d{2,5}\b/gi, "$1 <PORT>");
  output = output.replace(
    /(?<![\d.])v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?![\d.])/g,
    "<VERSION>",
  );

  output = output.replace(/\b[A-Za-z]:[\\/](?:[^\s"'<>|:*?]+[\\/]?)+/g, "<PATH>");
  output = output.replace(/(^|[\s([=])\/(?:[^\s"'<>]+\/)*[^\s"')<>]+/g, "$1<PATH>");

  return output;
}

export function normalizeByProfile(input, normalization = { profile: "none" }, options = {}) {
  switch (normalization.profile) {
    case "none":
      return String(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    case "cli-snapshot":
      return normalizeCliSnapshot(input, options);
    case "binary":
    case "json":
    case "screen-hash":
    case "custom":
      return input;
    default:
      throw new Error(`unknown normalization profile: ${normalization.profile}`);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const input = await readStdin();
  stdout.write(normalizeCliSnapshot(input));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
