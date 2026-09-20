// Expo Router uses query-string 7's CommonJS API. The patched decoder (0.5)
// is ESM; bridge its default export without changing either decoder algorithm
// or Router's public API. Remove when Expo adopts an updated query-string.
const fs = require('node:fs');
const file = require.resolve('query-string');
const source = fs.readFileSync(file, 'utf8');
const before = "const decodeComponent = require('decode-uri-component');";
const after =
  "const decoderModule = require('decode-uri-component');\nconst decodeComponent = decoderModule.default || decoderModule;";
if (source.includes(before)) fs.writeFileSync(file, source.replace(before, after));
else if (!source.includes(after))
  throw new Error('query-string changed: review the decoder compatibility patch.');
