import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

for (const stalledBody of [false, true]) {
  test(`the watching deadline interrupts stalled ${stalledBody ? 'bodies' : 'headers'}`, async () => {
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (request.method === 'POST') {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({ pod: { hostname: null }, deploy: { id: 'test', status: 'queued' }, appPath: '/test' }),
        );
      } else {
        requests += 1;
        if (stalledBody) {
          response.setHeader('content-type', 'application/json');
          response.write('{');
        }
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      await assert.rejects(
        execFileAsync(
          process.execPath,
          [
            new URL('./main.ts', import.meta.url).pathname,
            'deploy',
            '--pod',
            'test',
            '--image',
            'busybox:latest',
            '--timeout',
            '3',
          ],
          {
            timeout: 6000,
            env: {
              ...process.env,
              PODBY_API_ORIGIN: `http://127.0.0.1:${address.port}`,
              PODBY_REGISTRY_USERNAME: '',
              PODBY_REGISTRY_PASSWORD: '',
            },
          },
        ),
        (error: unknown) => {
          const failure = error as Error & { code: number; killed: boolean; stderr: string };
          assert.equal(failure.code, 1);
          assert.equal(failure.killed, false);
          assert.match(failure.stderr, /Stopped watching after 3s/);
          return true;
        },
      );
      assert.equal(requests, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
