import fs from 'node:fs';
const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const name = process.argv[3];
const step = run.transcript.find((t) => t.name === name);
console.log(JSON.stringify(step, null, 2).slice(0, Number(process.argv[4] ?? 4000)));
