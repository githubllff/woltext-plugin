import esbuild from 'esbuild';
import process from 'process';

const prod = process.argv[2] === 'production';

const ctx = await esbuild.context({
  entryPoints: ['main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  loader: { '.wasm': 'binary' },
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString().replace('T', ' ').slice(0, 19)) },
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}