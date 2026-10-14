import { homedir } from 'node:os';
import path from 'node:path';

export const API_VERSION = '2026-10-11';

export const USAGE = [
  'Usage:',
  '  podby login',
  '  podby deploy --static <name> [--append] [--no-wait | --timeout <seconds>]',
  '  podby deploy --pod <name> [--image <reference>] [--no-wait | --timeout <seconds>]',
  '  podby stats [--json]',
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
  | { command: 'stats'; json: boolean }
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

  if (command === 'stats' && (rest.length === 0 || (rest.length === 1 && rest[0] === '--json'))) {
    return { command: 'stats', json: rest.length === 1 };
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

  if (payload.error === 'name_in_use') return 'That name is already reserved on this server. Choose another name.';
  if (payload.error === 'upload_busy') return 'Another upload is being processed. Try again in a few seconds.';
  if (payload.error === 'append_base_unavailable')
    return 'The last successful files are unavailable. Deploy once without --append and wait for success, then append again.';

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

const NEAR_LIMIT = 0.8;

export type UsagePayload = {
  sites?: Array<{ name: string; usage: object | null; diskBytes: number; egressBytes: number }>;
  pods?: Array<{
    name: string;
    diskBytes: number | null;
    diskLimitBytes: number;
    egressBytes: number;
    egressLimitBytes: number;
  }>;
  staticPods?: Array<{
    sites: string[];
    diskBytes: number;
    diskLimitBytes: number;
    egressBytes: number;
    egressLimitBytes: number;
  }>;
};

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }

  return `${unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

// A zero limit means any use is over it.
function meterShare(used: number, limit: number): number {
  if (limit > 0) {
    return used / limit;
  }

  return used > 0 ? 1 : 0;
}

type UsageCell = { text: string; near: boolean };

function meterCell(used: number | null, limit: number): UsageCell {
  if (used === null) {
    return { text: 'No data yet', near: false };
  }

  const share = meterShare(used, limit);

  return {
    text: `${formatBytes(used)} of ${formatBytes(limit)}  ${Math.floor(share * 100)}%`,
    near: share >= NEAR_LIMIT,
  };
}

export function usageTable(payload: UsagePayload, color: boolean): string {
  // Site names repeat across servers, so each listed name takes the first unused site with that name.
  const unmatchedSites = [...(payload.sites ?? [])];
  const rows: UsageCell[][] = [];

  for (const staticPod of payload.staticPods ?? []) {
    rows.push([
      { text: `Static sites (${staticPod.sites.length})`, near: false },
      meterCell(staticPod.diskBytes, staticPod.diskLimitBytes),
      meterCell(staticPod.egressBytes, staticPod.egressLimitBytes),
    ]);

    for (const name of staticPod.sites) {
      const siteIndex = unmatchedSites.findIndex((site) => site.name === name);
      const site = siteIndex === -1 ? undefined : unmatchedSites.splice(siteIndex, 1)[0];
      const egress = !site ? '' : site.usage ? formatBytes(site.egressBytes) : 'No data yet';

      rows.push([
        { text: `  ${name}`, near: false },
        { text: site ? formatBytes(site.diskBytes) : '', near: false },
        { text: egress, near: false },
      ]);
    }
  }

  for (const pod of payload.pods ?? []) {
    rows.push([
      { text: `Pod ${pod.name}`, near: false },
      meterCell(pod.diskBytes, pod.diskLimitBytes),
      meterCell(pod.egressBytes, pod.egressLimitBytes),
    ]);
  }

  if (rows.length === 0) {
    return 'No static sites or pods yet.';
  }

  const header = ['', 'Disk', 'Egress this month'].map((text) => ({ text, near: false }));
  const widths = header.map((_, column) => Math.max(...[header, ...rows].map((row) => row[column].text.length)));
  const line = (row: UsageCell[]) =>
    row
      .map((cell, column) => {
        const padded = cell.text.padEnd(widths[column]);
        return cell.near && color ? `\x1b[33m${padded}\x1b[0m` : padded;
      })
      .join('   ')
      .trimEnd();
  const lines = [line(header), widths.map((width) => '─'.repeat(width)).join('   '), ...rows.map(line)];

  if (rows.some((row) => row.some((cell) => cell.near))) {
    lines.push('', `Some usage is at ${Math.round(NEAR_LIMIT * 100)}% or more of its allowance.`);
  }

  return lines.join('\n');
}
