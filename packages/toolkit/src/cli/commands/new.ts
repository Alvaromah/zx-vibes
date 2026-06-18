import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, emit, envError, userError } from '../output.js';

/** Walks up from this module to the package root (the dir holding templates/). */
function toolkitRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'templates'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('Cannot locate the zx-vibes templates directory');
}

function copyTemplate(src: string, dest: string, name: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (entry === 'AGENT_PLAYBOOK.md') continue;
    const from = join(src, entry);
    // npm strips .gitignore from packages; the template ships it unprefixed.
    const to = join(dest, entry === 'gitignore' ? '.gitignore' : entry);
    if (statSync(from).isDirectory()) {
      copyTemplate(from, to, name);
    } else {
      const content = readFileSync(from, 'utf8').replaceAll('__NAME__', name);
      writeFileSync(to, content);
    }
  }
}

/** Reserved device basenames on Windows — creating files/dirs with these names
 * fails or behaves abnormally, so reject them even though the regex allows them. */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function newCommand(name: string, opts: { json: boolean; template?: string; install?: boolean }): number {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
    throw userError(`Invalid project name '${name}' (use letters, digits, - and _)`, 'new');
  }
  if (process.platform === 'win32' && WINDOWS_RESERVED_NAME.test(name)) {
    throw userError(`Invalid project name '${name}': reserved device name on Windows`, 'new');
  }
  const dest = join(process.cwd(), name);
  if (existsSync(dest)) {
    throw userError(`Directory already exists: ${dest}`, 'new');
  }

  const root = toolkitRoot();
  const template = opts.template ?? 'game';
  // Validate the template name like the project name so it cannot escape the
  // templates/ directory via path separators or '..'.
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(template)) {
    throw userError(`Invalid template name '${template}' (use letters, digits, - and _)`, 'new');
  }
  const templateDir = join(root, 'templates', template);
  if (!existsSync(templateDir)) {
    const templatesDir = join(root, 'templates');
    const available = readdirSync(templatesDir)
      .filter((entry) => statSync(join(templatesDir, entry)).isDirectory())
      .sort();
    throw userError(`Unknown template '${template}'. Available: ${available.join(', ')}`, 'new');
  }
  // Scaffold transactionally: roll back a partially-created directory on failure
  // so the existsSync guard does not block a retry.
  try {
    copyTemplate(templateDir, dest, name);

    const agentPlaybook = readFileSync(join(templateDir, 'AGENT_PLAYBOOK.md'), 'utf8').replaceAll('__NAME__', name);
    writeFileSync(join(dest, 'AGENTS.md'), agentPlaybook);
    writeFileSync(join(dest, 'CLAUDE.md'), agentPlaybook);
    writeFileSync(join(dest, '.mcp.json'), `${claudeMcpJson()}\n`);
    mkdirSync(join(dest, 'docs', 'agents'), { recursive: true });
    writeFileSync(join(dest, 'docs', 'agents', 'codex-mcp.toml'), `${codexToml()}\n`);

    // Local copy of the reference docs so the agent reads files, not URLs.
    const docsSrc = join(root, 'docs', 'reference');
    if (existsSync(docsSrc)) {
      cpSync(docsSrc, join(dest, 'docs', 'reference'), { recursive: true });
    }
    const skillsSrc = join(root, 'docs', 'agents', 'skills');
    if (existsSync(skillsSrc)) {
      cpSync(skillsSrc, join(dest, 'docs', 'agents', 'skills'), { recursive: true });
    }
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw err;
  }

  const shouldInstall = opts.install ?? true;
  const installResult = shouldInstall ? installDependencies(dest, opts.json) : undefined;
  const next = [
    `cd ${name}`,
    ...(shouldInstall ? [] : ['npm install']),
    'npm run build',
    'npm test',
    'npm run verify',
  ];
  emit(
    {
      ok: true,
      stage: 'new',
      project: dest,
      template,
      install: shouldInstall ? installResult : { ok: false, skipped: true },
      next,
    },
    opts.json,
    () =>
      [
        `Created ${name}/ from the ${template} starter.`,
        shouldInstall
          ? 'Installed local zx-vibes dependency; npm scripts now use the project-local zxs bin.'
          : 'Skipped dependency installation; run npm install before npm scripts or npx zxs.',
        'Agent playbooks are in AGENTS.md and CLAUDE.md; skill router is in docs/agents/skills/INDEX.md; reference docs are in docs/reference/.',
        '',
        ...next.map((n) => `  ${n}`),
      ].join('\n')
  );
  return EXIT.OK;
}

function installDependencies(dest: string, json: boolean): { ok: true; command: string } {
  const command = npmInstallCommand();
  const result = spawnSync(command.bin, command.args, {
    cwd: dest,
    encoding: 'utf8',
    stdio: json ? 'pipe' : 'inherit',
  });
  if (result.error) {
    throw envError(
      `Created project but could not run npm install (${result.error.message}). Run npm install inside the project, then npm run build.`,
      'new'
    );
  }
  if ((result.status ?? 1) !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const detail = stderr ? `: ${stderr}` : '';
    throw envError(
      `Created project but npm install failed with exit code ${result.status ?? 1}${detail}. Run npm install inside the project, then npm run build.`,
      'new'
    );
  }
  return { ok: true, command: 'npm install' };
}

function npmInstallCommand(): { bin: string; args: string[] } {
  if (process.platform === 'win32') {
    return { bin: 'cmd.exe', args: ['/d', '/s', '/c', 'npm install'] };
  }
  return { bin: 'npm', args: ['install'] };
}

function codexToml(): string {
  return [
    '[mcp_servers.zx_vibes]',
    'command = "pnpm"',
    'args = ["exec", "zxs-mcp"]',
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 300',
  ].join('\n');
}

function claudeMcpJson(): string {
  return JSON.stringify(
    {
      mcpServers: {
        zx_vibes: {
          command: 'pnpm',
          args: ['exec', 'zxs-mcp'],
        },
      },
    },
    null,
    2
  );
}
