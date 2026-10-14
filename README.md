# @podby/cli

[![Test](https://github.com/podby/cli/actions/workflows/test.yml/badge.svg)](https://github.com/podby/cli/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/@podby/cli.svg)](https://www.npmjs.com/package/@podby/cli)

Command line for [PodBy](https://podby.com). Requires Node 24.21 or newer. The Codeberg mirror is `podby/cli`.

```sh
npm install -g @podby/cli
podby login
podby deploy --static docs
podby deploy --static docs --append
podby deploy --pod api
podby deploy --pod api --image ghcr.io/you/api:1.2.3
podby stats
```

`--static` preserves relative symlinks within the selected directory and rejects links outside it. `.git` directories are excluded. `--static` replaces the site's files. `--append` keeps the files already online and adds or overwrites the new ones. A deploy prints its dashboard link and its status until it ends; stopping the command does not stop the deploy. It stops watching after 5 minutes; `--timeout <seconds>` changes the status-watching deadline, including stalled network requests, and `--no-wait` exits after the upload.

`--pod` uploads the current directory, which needs a `Dockerfile` at its root, and PodBy builds it. `.git` and whatever the ignore file excludes are left out of the upload. `Dockerfile.dockerignore` takes precedence over `.dockerignore` when present. `--image` deploys an image built elsewhere instead; it must have a `linux/amd64` variant. For a private registry, set `PODBY_REGISTRY_USERNAME` and `PODBY_REGISTRY_PASSWORD` (a read-only token is enough); PodBy saves the login for later deploys of that pod. Uploads are scanned with ClamAV before they go live, and a deploy with a flagged file fails with the file names.

Pod files written outside mounted volumes are ephemeral and disappear when the container is replaced. Configure persistent volume mount paths in the pod dashboard. Both app versions share those volumes during a blue/green deployment, so the app must support concurrent access.

Static append uploads use the last successful deployment. If it is unavailable, deploy once without `--append` and wait for success before appending again.

## Development

The CLI talks to `https://app.podby.com`. To work against a local app, set `PODBY_API_ORIGIN=http://127.0.0.1:3001`. A login is kept per API host in `~/.config/podby/credentials.json`, so run `podby login` again after switching.

```sh
task install
task format
task build
task test
task publish
```
