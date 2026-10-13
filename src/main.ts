#!/usr/bin/env node

import { zipDirectory } from './archive.ts';

import { clearScreenDown, cursorTo, moveCursor } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { splitBuildContext } from './dockerignore.ts';
import {
  API_VERSION,
  apiOrigin,
  credentialsPath,
  deployFailure,
  deployIsFinished,
  deployPath,
  deployStatusPath,
  deployStatusText,
  formatDuration,
  loginFailure,
  parseArgs,
  registryLogin,
  USAGE,
  type DeployStatus,
} from './cli.ts';

const execFileAsync = promisify(execFile);

async function readToken(): Promise<string | null> {
  try {
    const stored = JSON.parse(await readFile(credentialsPath(), 'utf8')) as { token?: string; apiOrigin?: string };
    return stored.apiOrigin === apiOrigin() ? stored.token || null : null;
  } catch {
    return null;
  }
}

async function writeToken(token: string): Promise<void> {
  const filePath = credentialsPath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, JSON.stringify({ token, apiOrigin: apiOrigin() }), { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function api(pathname: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('API-Version', API_VERSION);
  const token = await readToken();

  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  return fetch(`${apiOrigin()}${pathname}`, { ...init, headers });
}

async function readPayload<Payload>(response: Response): Promise<Payload & { error?: string }> {
  try {
    return (await response.json()) as Payload & { error?: string };
  } catch {
    return { error: `${response.status} ${response.statusText}` } as Payload & { error?: string };
  }
}

function eraseLines(count: number): void {
  if (!stdout.isTTY) {
    return;
  }

  moveCursor(stdout, 0, -count);
  cursorTo(stdout, 0);
  clearScreenDown(stdout);
}

function postJson(pathname: string, body: unknown): Promise<Response> {
  return api(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function login(): Promise<void> {
  if (!stdin.isTTY) {
    console.error('podby login needs a terminal');
    process.exit(1);
  }

  const prompts = createInterface({ input: stdin, output: stdout });
  prompts.on('SIGINT', () => {
    stdout.write('\n');
    process.exit(130);
  });
  let email = '';
  let shownLines = 0;

  while (!email) {
    shownLines += 1;
    const typed = (await prompts.question('Email: ')).trim().toLowerCase();
    const requested = await postJson('/api/v1/login/email', { email: typed });

    if (requested.ok) {
      email = typed;
      break;
    }

    const payload = await readPayload(requested);
    console.error(loginFailure(payload.error, apiOrigin()));
    shownLines += 1;

    if (payload.error !== 'invalid_email') {
      prompts.close();
      process.exit(1);
    }
  }

  eraseLines(shownLines);
  console.log('We emailed you a code. It lasts 10 minutes.');
  shownLines = 1;

  for (let attempt = 1; ; attempt += 1) {
    shownLines += 1;
    const code = (await prompts.question('Code: ')).trim();
    const opened = await postJson('/api/v1/login/code', { email, code });
    const payload = await readPayload<{ token?: string }>(opened);

    if (opened.ok && payload.token) {
      prompts.close();
      eraseLines(shownLines);
      await writeToken(payload.token);
      console.log('Logged in');
      return;
    }

    console.error(loginFailure(payload.error, apiOrigin()));
    shownLines += 1;

    if (payload.error !== 'invalid_code' || attempt >= 5) {
      prompts.close();
      process.exit(1);
    }
  }
}

async function tarBuildContext(directory: string): Promise<Buffer> {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'podby-tar-'));
  const archivePath = path.join(tempDirectory, 'context.tgz');
  const listPath = path.join(tempDirectory, 'files');
  const { kept } = await splitBuildContext(directory);
  await writeFile(listPath, kept.map((entry) => `${entry}\0`).join(''));
  await execFileAsync('tar', ['--null', '--no-recursion', '-czf', archivePath, '-T', listPath], { cwd: directory });
  const bytes = await readFile(archivePath);
  await rm(tempDirectory, { recursive: true, force: true });

  return bytes;
}

async function deployBody(
  kind: 'static' | 'pod',
  image: string | null,
): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string; summary: string }> {
  if (image) {
    return {
      body: new TextEncoder().encode(JSON.stringify({ image, ...registryLogin() })),
      contentType: 'application/json',
      summary: image,
    };
  }

  const bytes = kind === 'static' ? await zipDirectory(process.cwd()) : await tarBuildContext(process.cwd());

  return {
    body: new Uint8Array(bytes),
    contentType: kind === 'static' ? 'application/zip' : 'application/gzip',
    summary: `${(bytes.length / 1_000_000).toFixed(1)} MB`,
  };
}

async function watchDeploy(input: {
  kind: 'static' | 'pod';
  name: string;
  deployId: string;
  status: DeployStatus;
  appUrl: string;
  hostname: string | null;
  timeoutSeconds: number;
}): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + input.timeoutSeconds * 1000;
  let status = input.status;
  let error: string | undefined;
  let printed = '';

  const show = (final: boolean) => {
    const line = `Status: ${deployStatusText(status)}`;

    if (stdout.isTTY) {
      cursorTo(stdout, 0);
      stdout.write(
        `\x1b[2K${line}${final ? '' : ` (${formatDuration(Math.round((Date.now() - startedAt) / 1000))})`}${final ? '\n' : ''}`,
      );
      return;
    }

    if (line !== printed) {
      console.log(line);
      printed = line;
    }
  };

  process.on('SIGINT', () => {
    stdout.write(stdout.isTTY ? '\n' : '');
    console.log(`Stopped watching. The deploy keeps going: ${input.appUrl}`);
    process.exit(0);
  });

  show(deployIsFinished(status));

  while (!deployIsFinished(status)) {
    if (Date.now() >= deadline) {
      stdout.write(stdout.isTTY ? '\n' : '');
      console.error(
        `Stopped watching after ${formatDuration(input.timeoutSeconds)}. The deploy keeps going: ${input.appUrl}`,
      );
      process.exit(1);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      const response = await api(deployStatusPath(input.kind, input.name, input.deployId));
      const payload = await readPayload<{ deploy?: { status: DeployStatus; error?: string } }>(response);

      if (response.status === 401 || response.status === 404) {
        stdout.write(stdout.isTTY ? '\n' : '');
        console.error(`Could not read the deploy status (${payload.error}). Check ${input.appUrl}`);
        process.exit(1);
      }

      if (response.ok && payload.deploy) {
        status = payload.deploy.status;
        error = payload.deploy.error;
      }
    } catch {
      // A dropped connection only pauses the status updates; the deploy itself runs on PodBy.
    }

    show(deployIsFinished(status));
  }

  if (status === 'error') {
    if (error) {
      console.error(error);
    }

    console.error(`The deploy failed. Details: ${input.appUrl}`);
    process.exit(1);
  }

  if (input.hostname) {
    console.log(`Live at https://${input.hostname}`);
  }
}

async function deploy(
  kind: 'static' | 'pod',
  name: string,
  options: { append: boolean; image: string | null; wait: boolean; timeoutSeconds: number },
): Promise<void> {
  if (!name) {
    console.error(USAGE);
    process.exit(1);
  }

  if (kind === 'pod' && !options.image) {
    try {
      await readFile(path.join(process.cwd(), 'Dockerfile'));
    } catch {
      console.error('podby deploy --pod requires a Dockerfile');
      process.exit(1);
    }
  }

  const { body, contentType, summary } = await deployBody(kind, options.image);
  console.log(`Uploading ${name} (${summary})...`);
  const response = await api(deployPath(kind, name, options.append), {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
  const payload = await readPayload<{
    site?: { hostname: string | null };
    pod?: { hostname: string | null };
    deploy?: { id: string; status: DeployStatus };
    appPath?: string;
    payPath?: string;
  }>(response);

  if (!response.ok || !payload.deploy) {
    console.error(deployFailure(payload, apiOrigin()));
    process.exit(1);
  }

  const appUrl = `${apiOrigin()}${payload.appPath ?? '/dashboard'}`;
  eraseLines(1);
  console.log(`Uploaded ${name}. The deploy is queued on PodBy.`);

  if (!options.wait) {
    console.log(`Follow it at ${appUrl}`);
    return;
  }

  console.log('You can stop this command at any time (Ctrl+C) without stopping the deploy.');
  console.log(`Follow it at ${appUrl}`);
  await watchDeploy({
    kind,
    name,
    deployId: payload.deploy.id,
    status: payload.deploy.status,
    appUrl,
    hostname: (payload.site ?? payload.pod)?.hostname ?? null,
    timeoutSeconds: options.timeoutSeconds,
  });
}

async function stats(): Promise<void> {
  const response = await api('/api/v1/usage');
  const payload = await readPayload(response);

  if (!response.ok) {
    console.error(deployFailure(payload, apiOrigin()));
    process.exit(1);
  }

  console.log(JSON.stringify(payload, null, 2));
}

const parsed = parseArgs(process.argv.slice(2));

try {
  if (parsed.command === 'login') {
    await login();
  } else if (parsed.command === 'deploy') {
    await deploy(parsed.deployKind, parsed.name, parsed);
  } else if (parsed.command === 'stats') {
    await stats();
  } else {
    console.error(USAGE);
    process.exit(1);
  }
} catch (error) {
  if (error instanceof TypeError && error.message === 'fetch failed') {
    console.error(`Could not reach ${apiOrigin()}. Check your connection and try again.`);
    process.exit(1);
  }

  throw error;
}
