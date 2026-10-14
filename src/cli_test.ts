import assert from 'node:assert/strict';
import test from 'node:test';

import {
  apiOrigin,
  credentialsPath,
  deployFailure,
  deployIsFinished,
  deployPath,
  deployStatusPath,
  formatDuration,
  loginFailure,
  parseArgs,
  registryLogin,
  usageTable,
} from './cli.ts';

test('a missing append base explains how to recover', () => {
  assert.match(
    deployFailure({ error: 'append_base_unavailable' }, 'https://app.podby.com'),
    /without --append and wait for success/,
  );
});

test('the API origin defaults to production and drops a trailing slash', () => {
  assert.equal(apiOrigin({}), 'https://app.podby.com');
  assert.equal(apiOrigin({ PODBY_API_ORIGIN: 'http://127.0.0.1:3001/' }), 'http://127.0.0.1:3001');
});

test('credentials live in the user config directory', () => {
  assert.equal(credentialsPath('/home/ada'), '/home/ada/.config/podby/credentials.json');
});

test('commands are explicit', () => {
  assert.deepEqual(parseArgs(['login']), { command: 'login' });
  assert.deepEqual(parseArgs(['stats']), { command: 'stats', json: false });
  assert.deepEqual(parseArgs(['stats', '--json']), { command: 'stats', json: true });
  assert.deepEqual(parseArgs(['stats', '--yaml']), { command: 'help' });
  assert.deepEqual(parseArgs(['deploy', '--static', 'docs']), {
    command: 'deploy',
    deployKind: 'static',
    name: 'docs',
    append: false,
    image: null,
    wait: true,
    timeoutSeconds: 300,
  });
  assert.deepEqual(parseArgs(['deploy', '--pod', 'api']), {
    command: 'deploy',
    deployKind: 'pod',
    name: 'api',
    append: false,
    image: null,
    wait: true,
    timeoutSeconds: 300,
  });
  assert.deepEqual(parseArgs(['deploy', '--static']), {
    command: 'deploy',
    deployKind: 'static',
    name: '',
    append: false,
    image: null,
    wait: true,
    timeoutSeconds: 300,
  });
  assert.deepEqual(parseArgs(['deploy']), { command: 'help' });
  assert.deepEqual(parseArgs([]), { command: 'help' });
});

test('append only applies to static deploys and can sit anywhere', () => {
  const appended = {
    command: 'deploy',
    deployKind: 'static',
    name: 'docs',
    append: true,
    image: null,
    wait: true,
    timeoutSeconds: 300,
  };
  assert.deepEqual(parseArgs(['deploy', '--static', 'docs', '--append']), appended);
  assert.deepEqual(parseArgs(['deploy', '--append', '--static', 'docs']), appended);
  assert.deepEqual(parseArgs(['deploy', '--pod', 'api', '--append']), { command: 'help' });
  assert.deepEqual(parseArgs(['deploy', '--static', '--pod', 'api']), { command: 'help' });
  assert.deepEqual(parseArgs(['deploy', '--static', 'docs', '--force']), { command: 'help' });
});

test('waiting can be skipped or given its own timeout in seconds', () => {
  const docs = { command: 'deploy', deployKind: 'static', name: 'docs', append: false, image: null };
  assert.deepEqual(parseArgs(['deploy', '--static', 'docs', '--no-wait']), {
    ...docs,
    wait: false,
    timeoutSeconds: 300,
  });
  assert.deepEqual(parseArgs(['deploy', '--static', 'docs', '--timeout', '60']), {
    ...docs,
    wait: true,
    timeoutSeconds: 60,
  });
  assert.deepEqual(parseArgs(['deploy', '--timeout=90', '--static', 'docs']), {
    ...docs,
    wait: true,
    timeoutSeconds: 90,
  });
  assert.deepEqual(parseArgs(['deploy', '--static', 'docs', '--timeout']), { command: 'help' });
  assert.deepEqual(parseArgs(['deploy', '--static', 'docs', '--timeout', '0']), { command: 'help' });
  assert.deepEqual(parseArgs(['deploy', '--static', 'docs', '--timeout', '1.5']), { command: 'help' });
  assert.deepEqual(parseArgs(['deploy', '--static', 'docs', '--no-wait', '--timeout', '60']), { command: 'help' });
});

test('a pod can deploy an image instead of the current directory', () => {
  const imaged = {
    command: 'deploy',
    deployKind: 'pod',
    name: 'api',
    append: false,
    image: 'ghcr.io/me/api:1.2',
    wait: true,
    timeoutSeconds: 300,
  };
  assert.deepEqual(parseArgs(['deploy', '--pod', 'api', '--image', 'ghcr.io/me/api:1.2']), imaged);
  assert.deepEqual(parseArgs(['deploy', '--image=ghcr.io/me/api:1.2', '--pod', 'api']), imaged);
  assert.deepEqual(parseArgs(['deploy', '--pod', 'api', '--image']), { command: 'help' });
  assert.deepEqual(parseArgs(['deploy', '--static', 'docs', '--image', 'nginx']), { command: 'help' });
});

test('a registry login is sent only when both parts are set', () => {
  assert.deepEqual(registryLogin({ PODBY_REGISTRY_USERNAME: 'me', PODBY_REGISTRY_PASSWORD: 'token' }), {
    registryUsername: 'me',
    registryPassword: 'token',
  });
  assert.deepEqual(registryLogin({ PODBY_REGISTRY_USERNAME: 'me' }), {});
  assert.deepEqual(registryLogin({}), {});
});

test('durations read in minutes and seconds', () => {
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(300), '5m');
  assert.equal(formatDuration(125), '2m 5s');
});

test('deploys post to the resource and are polled by id', () => {
  assert.equal(deployPath('static', 'docs', false), '/api/v1/sites/docs/deploys');
  assert.equal(deployPath('static', 'docs', true), '/api/v1/sites/docs/deploys?mode=append');
  assert.equal(deployPath('pod', 'api', false), '/api/v1/pods/api/deploys');
  assert.equal(deployStatusPath('pod', 'api', 'abc'), '/api/v1/pods/api/deploys/abc');
});

test('only success and error end the watch', () => {
  assert.equal(deployIsFinished('queued'), false);
  assert.equal(deployIsFinished('deploying'), false);
  assert.equal(deployIsFinished('success'), true);
  assert.equal(deployIsFinished('error'), true);
});

test('a payment refusal includes the pay path', () => {
  assert.equal(
    deployFailure({ error: 'payment_required', payPath: '/pay/static_pod/abc' }, 'https://app.podby.com'),
    'payment_required https://app.podby.com/pay/static_pod/abc',
  );
  assert.equal(deployFailure({}, 'https://app.podby.com'), 'Deploy failed');
  assert.equal(
    deployFailure({ error: 'unauthorized' }, 'https://app.podby.com'),
    'You are not logged in, or your session expired. Run podby login.',
  );
});

test('login errors read as sentences', () => {
  assert.equal(
    loginFailure('missing', 'https://app.podby.com'),
    'No account uses that email. Sign up at https://app.podby.com/signup first.',
  );
  assert.equal(loginFailure('something_new', 'https://app.podby.com'), 'something_new');
});

test('stats print used of total per static pod and pod', () => {
  const table = usageTable(
    {
      sites: [
        { name: 'blog', usage: {}, diskBytes: 3_000, egressBytes: 4_000 },
        { name: 'docs', usage: {}, diskBytes: 1_500_000, egressBytes: 2_000_000 },
        { name: 'docs', usage: null, diskBytes: 7_000, egressBytes: 0 },
      ],
      staticPods: [
        { sites: ['docs'], diskBytes: 1_500_000, diskLimitBytes: 1e9, egressBytes: 2_000_000, egressLimitBytes: 1e11 },
        { sites: ['docs', 'blog'], diskBytes: 10_000, diskLimitBytes: 1e9, egressBytes: 4_000, egressLimitBytes: 1e11 },
      ],
      pods: [{ name: 'api', diskBytes: null, diskLimitBytes: 1e10, egressBytes: 9e10, egressLimitBytes: 1e11 }],
    },
    false,
  );

  assert.match(table, /Static sites \(1\)\s+1\.5 MB of 1\.0 GB  0%\s+2\.0 MB of 100 GB  0%/);
  assert.match(table, /  docs\s+1\.5 MB\s+2\.0 MB/);
  assert.match(table, /  docs\s+7\.0 KB\s+No data yet/);
  assert.match(table, /  blog\s+3\.0 KB\s+4\.0 KB/);
  assert.match(table, /Pod api\s+No data yet\s+90\.0 GB of 100 GB  90%/);
  assert.match(table, /at 80% or more/);
  // oxlint-disable-next-line no-control-regex -- matching ANSI colour codes
  assert.doesNotMatch(table, /\x1b/);
});

test('stats without anything deployed say so', () => {
  assert.equal(usageTable({ sites: [], staticPods: [], pods: [] }, false), 'No static sites or pods yet.');
});

test('stats only colour cells at the warning threshold, which never rounds up', () => {
  const table = usageTable(
    {
      pods: [{ name: 'api', diskBytes: 8e9, diskLimitBytes: 1e10, egressBytes: 7.96e10, egressLimitBytes: 1e11 }],
    },
    true,
  );

  // oxlint-disable-next-line no-control-regex -- matching ANSI colour codes
  assert.match(table, /\x1b\[33m8\.0 GB of 10\.0 GB  80%\s*\x1b\[0m/);
  assert.match(table, /79\.6 GB of 100 GB  79%$/m);
  // oxlint-disable-next-line no-control-regex -- matching ANSI colour codes
  assert.equal(table.match(/\x1b\[33m/g)?.length, 1);
});
