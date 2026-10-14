import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises';
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

test('static archives preserve internal links and refuse outside files and directories', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'podby-links-test-'));
  try {
    const site = path.join(directory, 'site');
    await mkdir(site);
    await writeFile(path.join(site, 'index.html'), 'public');
    await symlink('index.html', path.join(site, 'home.html'));
    const archive = path.join(directory, 'site.zip');
    await writeFile(archive, await zipDirectory(site));
    await execFileAsync('unzip', ['-q', archive, '-d', path.join(directory, 'extracted')]);
    assert.equal((await lstat(path.join(directory, 'extracted/home.html'))).isSymbolicLink(), true);
    assert.equal(await readlink(path.join(directory, 'extracted/home.html')), 'index.html');
    await writeFile(path.join(directory, 'private.txt'), 'private');
    await symlink('../private.txt', path.join(site, 'leak'));
    await assert.rejects(zipDirectory(site), /points outside/);
    await rm(path.join(site, 'leak'));
    await symlink('..', path.join(site, 'parent'));
    await assert.rejects(zipDirectory(site), /points outside/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
