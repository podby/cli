import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function zipDirectory(directory: string): Promise<Buffer> {
  const archiveDirectory = await mkdtemp(path.join(tmpdir(), 'podby-zip-'));
  const zipPath = path.join(archiveDirectory, 'site.zip');
  try {
    await execFileAsync('zip', ['-r', '-q', zipPath, '.', '-x', '.git', '.git/*', '*/.git', '*/.git/*'], {
      cwd: directory,
    });
    return await readFile(zipPath);
  } finally {
    await rm(archiveDirectory, { recursive: true, force: true });
  }
}
