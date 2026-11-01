const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Logs build results in a format the VS Code `$esbuild-watch` problem matcher understands. */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
      }
      console.log('[watch] build finished');
    });
  },
};

/** The Judge webview uses VS Code's codicon icon font; ship its CSS and font next to the bundle. */
function copyCodicons() {
  const fs = require('fs');
  const path = require('path');
  const from = path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
  const to = path.join(__dirname, 'dist', 'codicons');
  fs.mkdirSync(to, { recursive: true });
  for (const file of ['codicon.css', 'codicon.ttf']) fs.copyFileSync(path.join(from, file), path.join(to, file));
}

async function main() {
  copyCodicons();
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'silent',
    plugins: [problemMatcherPlugin],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
