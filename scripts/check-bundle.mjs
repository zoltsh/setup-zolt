import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'setup-zolt-bundle-'));

try {
  const executable = resolve(root, 'node_modules', '.bin', 'ncc');
  await run(executable, [
    'build',
    resolve(root, 'src', 'index.ts'),
    '-o',
    temporary,
    '--license',
    'licenses.txt',
  ]);

  for (const file of ['index.js', 'licenses.txt', 'package.json']) {
    const expected = await readFile(resolve(root, 'dist', file));
    const actual = await readFile(resolve(temporary, file));
    if (!expected.equals(actual)) {
      throw new Error(`dist/${file} is stale. Run npm run bundle and commit the result.`);
    }
  }
} finally {
  await rm(temporary, { force: true, recursive: true });
}
