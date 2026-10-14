import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isIgnored, parseDockerignore, splitBuildContext } from './dockerignore.ts';

test('Dockerfile.dockerignore takes precedence, including when it is empty', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'podby-specific-ignore-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/app.ts'), 'app');
    await writeFile(path.join(root, 'Dockerfile'), 'FROM scratch');
    await writeFile(path.join(root, '.env'), 'secret');
    await writeFile(path.join(root, '.dockerignore'), 'src\n');
    await writeFile(path.join(root, 'Dockerfile.dockerignore'), '.env\nDockerfile.dockerignore\nDockerfile\n');
    const context = await splitBuildContext(root);
    assert.deepEqual(context.ignored, ['.env']);
    assert.deepEqual(context.kept.sort(), [
      '.dockerignore',
      'Dockerfile',
      'Dockerfile.dockerignore',
      'src',
      'src/app.ts',
    ]);
    await writeFile(path.join(root, 'Dockerfile.dockerignore'), '');
    assert.deepEqual((await splitBuildContext(root)).ignored, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dockerignore patterns follow Docker matching, last match wins', () => {
  const patterns = parseDockerignore(
    ['# comment', 'node_modules', '/docs/drafts/', '**/*.tmp', 'logs/*.log', '!logs/keep.log', '*.txt'].join('\n'),
  );

  assert.equal(isIgnored(patterns, 'node_modules'), true);
  assert.equal(isIgnored(patterns, 'node_modules/a/index.js'), true);
  assert.equal(isIgnored(patterns, 'src/node_modules'), false);
  assert.equal(isIgnored(patterns, 'docs/drafts/one.md'), true);
  assert.equal(isIgnored(patterns, 'docs/one.md'), false);
  assert.equal(isIgnored(patterns, 'a.tmp'), true);
  assert.equal(isIgnored(patterns, 'deep/er/a.tmp'), true);
  assert.equal(isIgnored(patterns, 'logs/a.log'), true);
  assert.equal(isIgnored(patterns, 'logs/keep.log'), false);
  assert.equal(isIgnored(patterns, 'notes.txt'), true);
  assert.equal(isIgnored(patterns, 'docs/notes.txt'), false);
  assert.equal(isIgnored(patterns, '# comment'), false);
});

test('a build context drops .git and ignored paths but always keeps the Dockerfile', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'podby-context-test-'));

  try {
    for (const file of [
      '.git/HEAD',
      'node_modules/a.js',
      'build/a.js',
      'build/keep.js',
      'src/app.ts',
      '.env',
      'Dockerfile',
    ]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), 'x');
    }

    await writeFile(path.join(root, '.dockerignore'), 'node_modules\nbuild\n!build/keep.js\n.env\nDockerfile\n');
    const context = await splitBuildContext(root);

    assert.deepEqual(context.kept.sort(), ['.dockerignore', 'Dockerfile', 'build/keep.js', 'src', 'src/app.ts']);
    assert.deepEqual(context.ignored.sort(), ['.env', '.git', 'build/a.js', 'node_modules']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
