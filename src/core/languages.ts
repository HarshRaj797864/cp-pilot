import * as path from 'node:path';
import { LANGUAGE_EXTENSIONS, Language } from './naming';
import { STORE_DIR } from './store';

/**
 * Shell command templates. Placeholders (substituted already quoted):
 * `${file}` source path, `${exe}` compiled output path, `${dir}` source folder, `${stem}` file name without extension.
 */
export interface LanguageCommands {
  compile?: string;
  run: string;
}

export function defaultCommands(platform: NodeJS.Platform = process.platform): Record<Language, LanguageCommands> {
  return {
    cpp: { compile: 'g++ -std=gnu++17 -O2 -Wall -o ${exe} ${file}', run: '${exe}' },
    c: { compile: 'gcc -std=gnu11 -O2 -Wall -o ${exe} ${file} -lm', run: '${exe}' },
    python: { run: `${platform === 'win32' ? 'python' : 'python3'} \${file}` },
    // Single-file source launcher (Java 11+): no class/file name matching needed.
    java: { run: 'java ${file}' },
    rust: { compile: 'rustc -O -o ${exe} ${file}', run: '${exe}' },
    go: { compile: 'go build -o ${exe} ${file}', run: '${exe}' },
    js: { run: 'node ${file}' },
  };
}

export function languageFromPath(file: string): Language | undefined {
  const ext = path.extname(file).slice(1).toLowerCase();
  const entry = Object.entries(LANGUAGE_EXTENSIONS).find(([, e]) => e === ext);
  return entry?.[0] as Language | undefined;
}

export interface ResolvedCommands {
  compile?: string;
  run: string;
  exe: string;
}

export function resolveCommands(
  file: string,
  commands: LanguageCommands,
  platform: NodeJS.Platform = process.platform,
): ResolvedCommands {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  const exe = path.join(dir, STORE_DIR, 'bin', `${stem}_${ext.slice(1)}${platform === 'win32' ? '.exe' : ''}`);

  const vars: Record<string, string> = { file, exe, dir, stem };
  const fill = (template: string) =>
    template.replace(/\$\{(file|exe|dir|stem)\}/g, (_, name: string) => shellQuote(vars[name], platform));

  return {
    compile: commands.compile ? fill(commands.compile) : undefined,
    run: fill(commands.run),
    exe,
  };
}

export function shellQuote(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return `"${arg.replace(/"/g, '""')}"`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
