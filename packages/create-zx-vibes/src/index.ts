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
  .option('--install', 'run pnpm install after copying files', false)
  .action((name: string | undefined, opts: { template: string; install?: boolean }) => {
    if (!name) {
      throw new Error('project name is required');
    }
    createProject(name, opts.template, opts.install ?? false);
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

  const docsSrc = join(root, 'docs', 'reference');
  if (existsSync(docsSrc)) cpSync(docsSrc, join(dest, 'docs', 'reference'), { recursive: true });

  if (install) {
    const command = pnpmInstallCommand();
    const result = spawnSync(command.bin, command.args, { cwd: dest, stdio: 'inherit' });
    if (result.error) {
      console.warn(`warning: could not run pnpm install (${result.error.message}); run pnpm install manually later`);
    } else if ((result.status ?? 1) !== 0) {
      console.warn('warning: pnpm install failed; the project was created, run pnpm install manually later');
    }
  }

  console.log(`Created ${name}/ from the ${template} starter.`);
  console.log('');
  console.log(`  cd ${name}`);
  if (!install) console.log('  pnpm install');
  console.log('  pnpm exec zxs verify');
  if (!install) {
    console.log('');
    console.log('Pass --install to install dependencies during project creation.');
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

function pnpmInstallCommand(): { bin: string; args: string[] } {
  if (process.platform === 'win32') {
    return { bin: 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm install'] };
  }
  return { bin: 'pnpm', args: ['install'] };
}
