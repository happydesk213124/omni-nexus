import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/domain/character/persona-global';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { personaGlobalMatch: match } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const row = (name, ...aliases) => ({ name, aliases });
const pick = (persona, ...rows) => match(rows, persona)?.name ?? null;

test('the whole name, then a share of the name, then an alias, then the list order', () => {
  assert.equal(pick('미나', row('다른이', '미나'), row('미나')), '미나', 'name over alias, wherever it stands');
  assert.equal(pick('미나', row('다른이', '미나'), row('미나코')), '미나코', 'a share of the name over an alias');
  assert.equal(pick('미나코', row('미나'), row('미나코짱')), '미나코짱', 'the bigger share wins');
  assert.equal(pick('미나', row('갑', '미나'), row('을', '미나')), '갑', 'a tie: the first in the list');
  assert.equal(pick('Kim Mina', row('kimmina')), 'kimmina', 'spaces and case do not count');
});

test('no answer, no character', () => {
  assert.equal(pick('미나', row('수아')), null);
  assert.equal(pick('', row('수아')), null, 'no persona name');
  assert.equal(pick('김미나코', row('김')), null, 'one letter is no share of a name');
  assert.equal(pick('김미나코짱', row('미나')), null, 'too small a share');
});
