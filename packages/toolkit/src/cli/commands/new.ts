import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, emit, userError } from '../output.js';

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

export function newCommand(name: string, opts: { json: boolean; template?: string }): number {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
    throw userError(`Invalid project name '${name}' (use letters, digits, - and _)`, 'new');
  }
  const dest = join(process.cwd(), name);
  if (existsSync(dest)) {
    throw userError(`Directory already exists: ${dest}`, 'new');
  }

  const root = toolkitRoot();
  const template = opts.template ?? 'game';
  const templateDir = join(root, 'templates', template);
  if (!existsSync(templateDir)) {
    const templatesDir = join(root, 'templates');
    const available = readdirSync(templatesDir)
      .filter((entry) => statSync(join(templatesDir, entry)).isDirectory())
      .sort();
    throw userError(`Unknown template '${template}'. Available: ${available.join(', ')}`, 'new');
  }
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

  const next = [
    `cd ${name}`,
    'zxs build src/main.asm',
    'zxs run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png',
    'zxs verify',
  ];
  emit(
    { ok: true, stage: 'new', project: dest, template, next },
    opts.json,
    () =>
      [
        `Created ${name}/ from the ${template} starter.`,
        'Agent playbooks are in AGENTS.md and CLAUDE.md; reference docs are in docs/reference/.',
        '',
        ...next.map((n) => `  ${n}`),
      ].join('\n')
  );
  return EXIT.OK;
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
