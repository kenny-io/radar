# Runner image for Radar's sandbox publisher (.factory/sandbox-publisher/architecture.md, section 3).
#
# The image holds the pinned Claude Agent SDK and node-tar and nothing else: no git, no Radar code, no
# credential, token or key. The runner scripts (run.mjs, prepare.mjs, probe.mjs, agent-environment.mjs,
# write-scope.mjs) are uploaded into /opt/radar-agent per run and checksum verified by the control plane, so a
# prompt or runner fix needs no new snapshot. Rebuild only when this file or the lockfile changes:
#   node scripts/operations/build-publisher-snapshot.mjs
FROM node:22.18.0-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/radar-agent
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

RUN groupadd --system radar-agent \
  && useradd --system --gid radar-agent --create-home --home-dir /home/radar-agent radar-agent \
  && mkdir -p /workspace/input /workspace/repo /output \
  && chown -R radar-agent:radar-agent /workspace /output /opt/radar-agent

USER radar-agent
# Created and chowned above: Docker would otherwise create the WORKDIR as root and the unprivileged runner could
# not extract into it.
WORKDIR /workspace/repo
ENTRYPOINT ["/bin/sh", "-lc"]
CMD ["sleep infinity"]
