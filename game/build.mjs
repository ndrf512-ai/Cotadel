// Сборка игры в один IIFE-файл (WebView грузит file://, ES-модули там недоступны).
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const serve = process.argv.includes('--serve');
fs.mkdirSync('dist', { recursive: true });
fs.copyFileSync('public/index.html', 'dist/index.html');

const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2019', 'chrome70'],
  minify: !serve,
  sourcemap: serve,
  outfile: 'dist/game.js',
  legalComments: 'none',
};

if (serve) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 8123 });
  console.log(`http://localhost:${port}`);
} else {
  await esbuild.build(opts);
  console.log('dist/game.js', (fs.statSync('dist/game.js').size / 1024).toFixed(0) + ' KB');
}
