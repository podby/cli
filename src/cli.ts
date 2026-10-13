import { homedir } from 'node:os';
import path from 'node:path';

export const API_VERSION = '2026-10-11';

export const USAGE = [
  'Usage:',
  '  podby login',
  '  podby deploy --static <name> [--append] [--no-wait | --timeout <seconds>]',
  '  podby deploy --pod <name> [--image <reference>] [--no-wait | --timeout <seconds>]',
  '  podby stats',
].join('\n');

export const DEFAULT_TIMEOUT_SECONDS = 300;

export function apiOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PODBY_API_ORIGIN || 'https://app.podby.com').replace(/\/$/, '');
}

export function credentialsPath(home: string = homedir()): string {
  return path.join(home, '.config', 'podby', 'credentials.json');
}

export type ParsedCommand =
  | { command: 'login' }
  | { command: 'stats' }
  | {
      command: 'deploy';
      deployKind: 'static' | 'pod';
      name: string;
      append: boolean;
      image: string | null;
      wait: boolean;
      timeoutSeconds: number;
    }
  | { command: 'help' };

function parseDeploy(args: string[]): ParsedCommand {
  const kinds: Array<'static' | 'pod'> = [];
  const names: string[] = [];
  let append = false;
  let image: string | null = null;
  let wait = true;
  let timeoutText: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--static' || arg === '--pod') {
      kinds.push(arg === '--static' ? 'static' : 'pod');
    } else if (arg === '--append') {
      append = true;
    } else if (arg === '--image') {
      image = args[index + 1] ?? '';
      index += 1;
    } else if (arg.startsWith('--image=')) {
      image = arg.slice('--image='.length);
    } else if (arg === '--no-wait') {
      wait = false;
    } else if (arg === '--timeout') {
      timeoutText = args[index + 1] ?? '';
      index += 1;
    } else if (arg.startsWith('--timeout=')) {
      timeoutText = arg.slice('--timeout='.length);
    } else if (arg.startsWith('--')) {
      return { command: 'help' };
    } else {
      names.push(arg);
    }
  }

  const timeoutSeconds = timeoutText === null ? DEFAULT_TIMEOUT_SECONDS : parseInt(timeoutText, 10);
  const timeoutIsValid = timeoutText === null || (/^\d+$/.test(timeoutText) && timeoutSeconds > 0);
  const deployKind = kinds[0];

  if (kinds.length !== 1 || !deployKind || names.length > 1 || !timeoutIsValid) {
    return { command: 'help' };
  }

  if ((deployKind === 'pod' && append) || (!wait && timeoutText !== null)) {
    return { command: 'help' };
  }

  if (image !== null && (deployKind !== 'pod' || !image)) {
    return { command: 'help' };
  }

  return { command: 'deploy', deployKind, name: names[0] ?? '', append, image, wait, timeoutSeconds };
}

export function parseArgs(argv: string[]): ParsedCommand {
  const [command, ...rest] = argv;

  if (command === 'login' && rest.length === 0) {
    return { command: 'login' };
  }

  if (command === 'stats' && rest.length === 0) {
    return { command: 'stats' };
  }

  return command === 'deploy' ? parseDeploy(rest) : { command: 'help' };
}

export function deployPath(kind: 'static' | 'pod', name: string, append: boolean): string {
  const collection = kind === 'static' ? 'sites' : 'pods';
  const mode = append ? '?mode=append' : '';

  return `/api/v1/${collection}/${encodeURIComponent(name)}/deploys${mode}`;
}

export function deployStatusPath(kind: 'static' | 'pod', name: string, deployId: string): string {
  const collection = kind === 'static' ? 'sites' : 'pods';

  return `/api/v1/${collection}/${encodeURIComponent(name)}/deploys/${encodeURIComponent(deployId)}`;
}

export type DeployStatus = 'queued' | 'deploying' | 'success' | 'error';

export function deployIsFinished(status: DeployStatus): boolean {
  return status === 'success' || status === 'error';
}

export function deployStatusText(status: DeployStatus): string {
  if (status === 'queued') {
    return 'queued, waiting for a free worker';
  }

  if (status === 'deploying') {
    return 'deploying';
  }

  return status === 'success' ? 'success' : 'error';
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function deployFailure(payload: { error?: string; payPath?: string }, origin: string): string {
  if (payload.error === 'unauthorized') {
    return 'You are not logged in, or your session expired. Run podby login.';
  }

  if (payload.payPath) {
    return `${payload.error ?? 'Deploy failed'} ${origin}${payload.payPath}`;
  }

  if (payload.error === 'invalid_image') {
    return 'That is not an image reference. Use one like ghcr.io/you/app:1.2.3.';
  }

  if (payload.error === 'missing_dockerfile') {
    return 'The upload has no Dockerfile at its root.';
  }

  return payload.error || 'Deploy failed';
}

export function registryLogin(env: NodeJS.ProcessEnv = process.env): {
  registryUsername?: string;
  registryPassword?: string;
} {
  const username = env.PODBY_REGISTRY_USERNAME || '';
  const password = env.PODBY_REGISTRY_PASSWORD || '';

  return username && password ? { registryUsername: username, registryPassword: password } : {};
}

export function loginFailure(error: string | undefined, origin: string): string {
  if (error === 'invalid_email') {
    return 'That does not look like an email address.';
  }

  if (error === 'invalid_code') {
    return 'That code did not work.';
  }

  if (error === 'missing') {
    return `No account uses that email. Sign up at ${origin}/signup first.`;
  }

  if (error === 'rate_limited') {
    return 'Too many codes were sent to that email. Wait ten minutes and try again.';
  }

  return error || 'Login failed';
}
