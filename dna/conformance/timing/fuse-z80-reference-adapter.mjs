#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const VALID_EVENT_TYPES = new Set(["MR", "MW", "MC", "PR", "PW", "PC"]);

function isBlank(line) {
  return line.trim() === "";
}

function isTerminator(line) {
  return line.trim() === "-1";
}

function isHex(value) {
  return /^[0-9a-f]+$/i.test(value);
}

function isRegisterLine(line) {
  const parts = line.trim().split(/\s+/);
  return parts.length === 13 && parts.every(isHex);
}

function isStateLine(line) {
  const parts = line.trim().split(/\s+/);
  return parts.length === 7 && parts.every((part) => /^-?[0-9a-f]+$/i.test(part));
}

function isEventLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 3 || parts.length > 4) {
    return false;
  }
  return /^\d+$/.test(parts[0]) && VALID_EVENT_TYPES.has(parts[1]) && isHex(parts[2]);
}

function skipBlank(lines, index) {
  let next = index;
  while (next < lines.length && isBlank(lines[next])) {
    next += 1;
  }
  return next;
}

function parseInputMemoryLines(lines, index, source, description) {
  let next = index;
  let writes = 0;
  while (next < lines.length && !isTerminator(lines[next])) {
    const parts = lines[next].trim().split(/\s+/);
    if (parts.length < 2 || !isHex(parts[0]) || parts.at(-1) !== "-1") {
      throw new Error(`${source}: ${description}: invalid memory line '${lines[next]}'`);
    }
    writes += parts.length - 2;
    next += 1;
  }
  if (next >= lines.length) {
    throw new Error(`${source}: ${description}: missing memory terminator`);
  }
  return { next: next + 1, writes };
}

function parseExpectedMemoryLines(lines, index, source, description) {
  let next = index;
  let writes = 0;
  while (next < lines.length && !isBlank(lines[next])) {
    if (isTerminator(lines[next])) {
      next += 1;
      break;
    }
    const parts = lines[next].trim().split(/\s+/);
    if (parts.length < 2 || !isHex(parts[0]) || parts.at(-1) !== "-1") {
      throw new Error(`${source}: ${description}: invalid memory line '${lines[next]}'`);
    }
    writes += parts.length - 2;
    next += 1;
  }
  return { next, writes };
}

function parseInputCases(text, source) {
  const lines = text.split(/\r?\n/);
  const cases = [];
  let index = 0;

  while (true) {
    index = skipBlank(lines, index);
    if (index >= lines.length) {
      break;
    }

    const description = lines[index].trim();
    index += 1;
    const registers = lines[index]?.trim() ?? "";
    if (!isRegisterLine(registers)) {
      throw new Error(`${source}: ${description}: expected initial register line`);
    }
    index += 1;

    const state = lines[index]?.trim() ?? "";
    if (!isStateLine(state)) {
      throw new Error(`${source}: ${description}: expected initial state line`);
    }
    index += 1;

    const memory = parseInputMemoryLines(lines, index, source, description);
    index = memory.next;
    cases.push({ description, memoryWrites: memory.writes });
  }

  return cases;
}

function parseExpectedCases(text, source) {
  const lines = text.split(/\r?\n/);
  const cases = [];
  let index = 0;

  while (true) {
    index = skipBlank(lines, index);
    if (index >= lines.length) {
      break;
    }

    const description = lines[index].trim();
    index += 1;
    let events = 0;
    while (index < lines.length && isEventLine(lines[index])) {
      events += 1;
      index += 1;
    }

    const registers = lines[index]?.trim() ?? "";
    if (!isRegisterLine(registers)) {
      throw new Error(`${source}: ${description}: expected final register line`);
    }
    index += 1;

    const state = lines[index]?.trim() ?? "";
    if (!isStateLine(state)) {
      throw new Error(`${source}: ${description}: expected final state line`);
    }
    index += 1;

    const memory = parseExpectedMemoryLines(lines, index, source, description);
    index = memory.next;
    cases.push({ description, events, memoryWrites: memory.writes });
  }

  return cases;
}

function findPayload(request, suffix) {
  const payload = request.payloads?.find((entry) => entry.path.endsWith(suffix));
  if (!payload?.localPath) {
    throw new Error(`missing payload '${suffix}'`);
  }
  return payload.localPath;
}

function compareCases(inputCases, expectedCases) {
  const failures = [];
  if (inputCases.length !== expectedCases.length) {
    failures.push(`case count mismatch: tests.in=${inputCases.length}, tests.expected=${expectedCases.length}`);
  }

  const count = Math.min(inputCases.length, expectedCases.length);
  for (let index = 0; index < count; index += 1) {
    if (inputCases[index].description !== expectedCases[index].description) {
      failures.push(
        `case ${index + 1} description mismatch: '${inputCases[index].description}' != '${expectedCases[index].description}'`,
      );
      if (failures.length >= 5) {
        break;
      }
    }
  }
  return failures;
}

async function readRequest() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function emit(report) {
  console.log(JSON.stringify(report));
}

async function main() {
  const request = await readRequest();
  if (request.kind !== "timing-fuse-z80") {
    emit({ status: "error", message: `unsupported request kind '${request.kind}'` });
    return;
  }

  const testsIn = findPayload(request, "tests.in");
  const testsExpected = findPayload(request, "tests.expected");
  const inputCases = parseInputCases(await readFile(testsIn, "utf8"), "tests.in");
  const expectedCases = parseExpectedCases(await readFile(testsExpected, "utf8"), "tests.expected");
  const failures = compareCases(inputCases, expectedCases);

  if (failures.length > 0) {
    emit({
      status: "fail",
      tests: Math.max(inputCases.length, expectedCases.length),
      failures: failures.length,
      message: failures[0],
      details: { failures },
    });
    return;
  }

  emit({
    status: "pass",
    tests: expectedCases.length,
    failures: 0,
    message: "FUSE Z80 reference transcript parsed and aligned",
    details: {
      events: expectedCases.reduce((sum, testCase) => sum + testCase.events, 0),
      inputMemoryWrites: inputCases.reduce((sum, testCase) => sum + testCase.memoryWrites, 0),
      expectedMemoryWrites: expectedCases.reduce((sum, testCase) => sum + testCase.memoryWrites, 0),
    },
  });
}

main().catch((error) => {
  emit({
    status: "error",
    message: error instanceof Error ? error.message : String(error),
  });
});
