import {build} from 'esbuild-wasm';
await build({entryPoints:['src/index.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/worker.js',external:['node:*'],sourcemap:true});
console.log('Cloudflare Worker bundle: dist/worker.js');
