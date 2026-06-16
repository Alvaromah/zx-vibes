import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

const program = new Command();
program.exitOverride();
program.configureOutput({ writeErr: () => undefined });

program
  .name('create-zx-vibes')
  .description('Create a zx-vibes ZX Spectrum agent project')
  .argument('[name]', 'project directory name')
  .option('--template <name>', 'starter template: game or platformer', 'game')
  .option('--install', 'run npm install after copying files')
  .option('--no-install', 'skip npm install after scaffolding')
  .action((name: string | undefined, opts: { template: string; install?: boolean }) => {
    if (!name) {
      throw new Error('project name is required');
    }
    createProject(name, opts.template, opts.install ?? true);
  });

program.parseAsync().catch((err: unknown) => {
  if (typeof err === 'object' && err !== null && 'exitCode' in err && err.exitCode === 0) {
    process.exitCode = 0;
    return;
  }
  const message = err instanceof Error ? err.message.replace(/^error:\s*/i, '') : String(err);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});

function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'starters'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('Cannot locate starter assets');
}

function createProject(name: string, template: string, install: boolean): void {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
    throw new Error(`Invalid project name '${name}' (use letters, digits, - and _)`);
  }
  const root = packageRoot();
  const src = join(root, 'starters', template);
  if (!existsSync(src)) {
    const available = readdirSync(join(root, 'starters')).filter((entry) => statSync(join(root, 'starters', entry)).isDirectory());
    throw new Error(`Unknown template '${template}'. Available: ${available.join(', ')}`);
  }

  const dest = resolve(process.cwd(), name);
  if (existsSync(dest)) throw new Error(`Directory already exists: ${dest}`);
  copyTemplate(src, dest, name);
  const agentPlaybook = readFileSync(join(src, 'AGENT_PLAYBOOK.md'), 'utf8').replaceAll('__NAME__', name);
  writeFileSync(join(dest, 'AGENTS.md'), agentPlaybook);
  writeFileSync(join(dest, 'CLAUDE.md'), agentPlaybook);
  writeFileSync(join(dest, '.mcp.json'), `${claudeMcpJson()}\n`);
  mkdirSync(join(dest, 'docs', 'agents'), { recursive: true });
  writeFileSync(join(dest, 'docs', 'agents', 'codex-mcp.toml'), `${codexToml()}\n`);

  const docsSrc = join(root, 'docs', 'reference');
  if (existsSync(docsSrc)) cpSync(docsSrc, join(dest, 'docs', 'reference'), { recursive: true });
  const skillsSrc = join(root, 'docs', 'agents', 'skills');
  if (existsSync(skillsSrc)) cpSync(skillsSrc, join(dest, 'docs', 'agents', 'skills'), { recursive: true });

  if (install) {
    installDependencies(dest);
  }

  console.log(`Created ${name}/ from the ${template} starter.`);
  console.log('');
  console.log(`  cd ${name}`);
  if (!install) console.log('  npm install');
  console.log('  npm run build');
  console.log('  npm test');
  console.log('  npm run verify');
  if (!install) {
    console.log('');
    console.log('Dependencies were not installed; run npm install before npm scripts or npx zxs.');
  }
}

function copyTemplate(src: string, dest: string, name: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (entry === 'AGENT_PLAYBOOK.md') continue;
    const from = join(src, entry);
    const to = join(dest, entry === 'gitignore' ? '.gitignore' : entry);
    if (statSync(from).isDirectory()) {
      copyTemplate(from, to, name);
    } else {
      const content = readFileSync(from, 'utf8').replaceAll('__NAME__', name);
      writeFileSync(to, content);
    }
  }
}

function installDependencies(dest: string): void {
  const command = npmInstallCommand();
  const result = spawnSync(command.bin, command.args, { cwd: dest, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) {
    throw new Error(
      `Created project but could not run npm install (${result.error.message}). Run npm install inside the project, then npm run build.`
    );
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `Created project but npm install failed with exit code ${result.status ?? 1}. Run npm install inside the project, then npm run build.`
    );
  }
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
