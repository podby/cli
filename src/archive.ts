import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, readlink, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function zipDirectory(directory: string): Promise<Buffer> {
  directory = await realpath(directory);
  const inside = (target: string) => target === directory || target.startsWith(`${directory}${path.sep}`);
  async function checkLinks(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await readlink(filename);
        if (path.isAbsolute(target) || !inside(path.resolve(current, target)) || !inside(await realpath(filename))) {
          throw new Error(`The link ${path.relative(directory, filename)} points outside the deployment directory.`);
        }
      } else if (entry.isDirectory()) {
        await checkLinks(filename);
      }
    }
  }
  await checkLinks(directory);
  const archiveDirectory = await mkdtemp(path.join(tmpdir(), 'podby-zip-'));
  const zipPath = path.join(archiveDirectory, 'site.zip');
  try {
    await execFileAsync('zip', ['-r', '-y', '-q', zipPath, '.', '-x', '.git', '.git/*', '*/.git', '*/.git/*'], {
      cwd: directory,
    });
    return await readFile(zipPath);
  } finally {
    await rm(archiveDirectory, { recursive: true, force: true });
  }
}
