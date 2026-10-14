import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type IgnorePattern = { regex: RegExp; dirs: number; exclusion: boolean };

const ALWAYS_SENT = new Set(['Dockerfile', '.dockerignore', 'Dockerfile.dockerignore']);

// Same translation Docker's patternmatcher applies, so a context is cut exactly as `docker build` would cut it.
function patternRegex(pattern: string): RegExp {
  let source = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        source += index + 1 >= pattern.length ? '.*' : '(.*/)?';

        if (pattern[index + 1] === '/') {
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else if (character === '\\') {
      index += 1;

      if (index < pattern.length) {
        source += `\\${pattern[index]}`;
      }
    } else if ('.+()|{}$'.includes(character)) {
      source += `\\${character}`;
    } else {
      source += character;
    }
  }

  return new RegExp(`^${source}$`);
}

export function parseDockerignore(text: string): IgnorePattern[] {
  const patterns: IgnorePattern[] = [];

  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (line.startsWith('#')) {
      continue;
    }

    let pattern = line.trim();
    const exclusion = pattern.startsWith('!');

    if (exclusion) {
      pattern = pattern.slice(1).trim();
    }

    if (!pattern) {
      continue;
    }

    pattern = path.posix.normalize(pattern).replace(/(.)\/+$/, '$1');

    if (pattern.length > 1 && pattern.startsWith('/')) {
      pattern = pattern.slice(1);
    }

    patterns.push({ regex: patternRegex(pattern), dirs: pattern.split('/').length, exclusion });
  }

  return patterns;
}

export function isIgnored(patterns: IgnorePattern[], relativePath: string): boolean {
  const parent = path.posix.dirname(relativePath);
  const parentDirs = parent === '.' ? [] : parent.split('/');
  let matched = false;

  for (const pattern of patterns) {
    if (pattern.exclusion !== matched) {
      continue;
    }

    let match = pattern.regex.test(relativePath);

    if (!match && parentDirs.length > 0 && pattern.dirs <= parentDirs.length) {
      match = pattern.regex.test(parentDirs.slice(0, pattern.dirs).join('/'));
    }

    if (match) {
      matched = !pattern.exclusion;
    }
  }

  return matched;
}

async function readPatterns(root: string): Promise<IgnorePattern[]> {
  for (const name of ['Dockerfile.dockerignore', '.dockerignore']) {
    try {
      return parseDockerignore(await readFile(path.join(root, name), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return [];
}

// `.git` never goes up, even where `docker build` would send it; `ignored` lists whole directories once where it can.
export async function splitBuildContext(root: string): Promise<{ kept: string[]; ignored: string[] }> {
  const patterns = await readPatterns(root);
  const hasExclusions = patterns.some((pattern) => pattern.exclusion);
  const kept: string[] = [];
  const ignored: string[] = [];

  async function walk(relativeDirectory: string): Promise<boolean> {
    let keptAny = false;

    for (const entry of await readdir(path.join(root, relativeDirectory), { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;

      if (relativePath === '.git') {
        ignored.push(relativePath);
        continue;
      }

      const matched = !ALWAYS_SENT.has(relativePath) && isIgnored(patterns, relativePath);

      if (!entry.isDirectory()) {
        (matched ? ignored : kept).push(relativePath);
        keptAny ||= !matched;
        continue;
      }

      if (matched && !hasExclusions) {
        ignored.push(relativePath);
        continue;
      }

      const keptPosition = kept.length;
      const ignoredPosition = ignored.length;
      const keptChildren = await walk(relativePath);

      if (!matched) {
        kept.splice(keptPosition, 0, relativePath);
        keptAny = true;
      } else if (keptChildren) {
        keptAny = true;
      } else {
        ignored.splice(ignoredPosition, ignored.length - ignoredPosition, relativePath);
      }
    }

    return keptAny;
  }

  await walk('');

  return { kept, ignored };
}
