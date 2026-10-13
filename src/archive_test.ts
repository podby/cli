import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { zipDirectory } from './archive.ts';

const execFileAsync = promisify(execFile);

test('static archives exclude git repositories but keep similarly named content', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'podby-archive-test-'));
  try {
    for (const name of ['.git/config', 'nested/.git/config', '.gitbook/index.html', 'guide.git.html', '.gitignore']) {
      await mkdir(path.dirname(path.join(directory, 'site', name)), { recursive: true });
      await writeFile(path.join(directory, 'site', name), 'content');
    }
    const archivePath = path.join(directory, 'site.zip');
    await writeFile(archivePath, await zipDirectory(path.join(directory, 'site')));
    const { stdout } = await execFileAsync('unzip', ['-Z1', archivePath]);
    assert.match(stdout, /\.gitbook\/index.html/);
    assert.match(stdout, /guide.git.html/);
    assert.match(stdout, /\.gitignore/);
    assert.doesNotMatch(stdout, /(?:^|\/)\.git(?:\/|$)/m);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
