# Local production HTTP capacity test

PASS. Run command: DATABASE_URL=<dedicated local DB> npx tsx .factory/production-launch/qa/load.mts. No remote target is accepted.

```json
{
  "verdict": "PASS",
  "run": "load-1793651566243-9c877c",
  "startedAt": "2026-11-02T20:32:46.243Z",
  "finishedAt": "2026-11-02T20:33:24.549Z",
  "target": "http://127.0.0.1:3901",
  "environment": {
    "node": "v22.18.0",
    "platform": "darwin",
    "architecture": "arm64",
    "logicalCpus": 10,
    "memoryGiB": 32,
    "sessions": 200,
    "uniqueBusinesses": 200,
    "worker": false,
    "billing": "off (server launch configuration supplied by PM)",
    "fixtures": "sparse active businesses; direct DB sessions, no password hashing/signin capacity claim"
  },
  "checks": {
    "noFatal": true,
    "noHttpOrTenancyErrors": true,
    "all200Streams": true,
    "atLeastThreePingsPerStreamAverage": true,
    "streamRevisionDelivery": true,
    "noUnexpectedStreamErrors": true,
    "sustainedP95Under2000ms": true,
    "sustainedP99Under5000ms": true,
    "actualDurationAtLeast35sec": true,
    "dbSamplerHealthy": true,
    "scopedFixturesRemoved": true
  },
  "groups": {
    "preflight": {
      "n": 1,
      "p50": 55.4,
      "p95": 55.4,
      "p99": 55.4,
      "max": 55.4,
      "errors": 0
    },
    "me": {
      "n": 2702,
      "p50": 8.3,
      "p95": 446.9,
      "p99": 1018.9,
      "max": 1318.3,
      "errors": 0
    },
    "burst": {
      "n": 200,
      "p50": 405.7,
      "p95": 450.2,
      "p99": 452.9,
      "max": 453.4,
      "errors": 0
    },
    "cross-tenant-denied": {
      "n": 10,
      "p50": 12.5,
      "p95": 13.1,
      "p99": 13.1,
      "max": 13.1,
      "errors": 0
    },
    "public": {
      "n": 532,
      "p50": 23.1,
      "p95": 431,
      "p99": 973,
      "max": 1509.8,
      "errors": 0
    },
    "workspace": {
      "n": 2146,
      "p50": 17,
      "p95": 723.2,
      "p99": 1926.2,
      "max": 2057.9,
      "errors": 0
    },
    "postflight": {
      "n": 1,
      "p50": 3.2,
      "p95": 3.2,
      "p99": 3.2,
      "max": 3.2,
      "errors": 0
    }
  },
  "sustained": {
    "n": 5380,
    "p50": 12.4,
    "p95": 631.1,
    "p99": 1398.3,
    "max": 2057.9,
    "elapsedMs": 36443,
    "requestsPerSecond": 147.6
  },
  "burstMs": 466,
  "sse": {
    "attempted": 200,
    "opened": 200,
    "firstFrames": 200,
    "pings": 600,
    "revisions": 70,
    "errors": [],
    "startupMs": {
      "n": 200,
      "p50": 562.7,
      "p95": 624.2,
      "p99": 626.6,
      "max": 627.1
    }
  },
  "db": {
    "samples": 149,
    "peakTotalConnections": 11,
    "peakOtherConnections": 10,
    "peakActiveConnections": 3,
    "maxConnections": 100,
    "sampleErrors": 0
  },
  "errors": [],
  "limitations": [
    "Local production build, loopback network and local Postgres only; not proof of Railway/production capacity.",
    "Sparse datasets do not represent mature workspaces or large response payloads.",
    "HTTP load reads HTML bodies without downloading browser subresources/hydrating JavaScript; browser behavior is separate QA.",
    "GET-only application workload plus local fixture revision updates; no signup/bcrypt, crawl, AI, provider quotas, worker backlog, publishing, email or Stripe/payment capacity tested.",
    "200 active sessions use one SSE connection each plus mixed GETs around once per1–1.5seconds; not200 simultaneous expensive requests continuously.",
    "Configured app pool max10 per process; sampled other connections may include separate Next route bundles/processes and are reported without assuming a10-connection ceiling."
  ]
}
```

Initial-run binary provenance (PM supplied and architect verified by reading `.next-launch-build/BUILD_ID`): `sSixJBoLn4GfQHo4grAMt`. This binary preceded final hydration/network-dispatcher changes. Initial sustained count above includes one fixture-identity GET before the timed phase; actual timed workload5379 GETs; rate still147.6req/s after rounding. Script now excludes that probe from timed totals. Final-build rerun will append below.

# Local production HTTP capacity test

PASS. Run command: DATABASE_URL=<dedicated local DB> npx tsx .factory/production-launch/qa/load.mts. No remote target is accepted.

```json
{
  "verdict": "PASS",
  "run": "load-1793651886704-e078f3",
  "startedAt": "2026-11-02T20:38:06.706Z",
  "finishedAt": "2026-11-02T20:38:44.640Z",
  "target": "http://127.0.0.1:3901",
  "testedBuild": {
    "directory": ".next-launch-build-final",
    "buildId": "fQAS3QW-qLMiPPO_ayayr"
  },
  "environment": {
    "node": "v22.18.0",
    "platform": "darwin",
    "architecture": "arm64",
    "logicalCpus": 10,
    "memoryGiB": 32,
    "sessions": 200,
    "uniqueBusinesses": 200,
    "worker": false,
    "billing": "off (server launch configuration supplied by PM)",
    "fixtures": "sparse active businesses; direct DB sessions, no password hashing/signin capacity claim"
  },
  "checks": {
    "noFatal": true,
    "noHttpOrTenancyErrors": true,
    "all200Streams": true,
    "atLeastThreePingsPerStreamAverage": true,
    "streamRevisionDelivery": true,
    "noUnexpectedStreamErrors": true,
    "sustainedP95Under2000ms": true,
    "sustainedP99Under5000ms": true,
    "actualDurationAtLeast35sec": true,
    "dbSamplerHealthy": true,
    "scopedFixturesRemoved": true
  },
  "groups": {
    "preflight": {
      "n": 1,
      "p50": 58,
      "p95": 58,
      "p99": 58,
      "max": 58,
      "errors": 0
    },
    "me": {
      "n": 2824,
      "p50": 7.1,
      "p95": 61.6,
      "p99": 504.5,
      "max": 521.9,
      "errors": 0
    },
    "burst": {
      "n": 200,
      "p50": 317.5,
      "p95": 358.3,
      "p99": 362.9,
      "max": 363.5,
      "errors": 0
    },
    "cross-tenant-denied": {
      "n": 10,
      "p50": 12,
      "p95": 13.2,
      "p99": 13.2,
      "max": 13.2,
      "errors": 0
    },
    "public": {
      "n": 558,
      "p50": 16.8,
      "p95": 175.8,
      "p99": 488.5,
      "max": 493.9,
      "errors": 0
    },
    "workspace": {
      "n": 2259,
      "p50": 13.8,
      "p95": 161.7,
      "p99": 786.8,
      "max": 843.6,
      "errors": 0
    },
    "postflight": {
      "n": 1,
      "p50": 4.3,
      "p95": 4.3,
      "p99": 4.3,
      "max": 4.3,
      "errors": 0
    }
  },
  "sustained": {
    "n": 5640,
    "p50": 10.4,
    "p95": 124.6,
    "p99": 728.4,
    "max": 843.6,
    "elapsedMs": 36331,
    "requestsPerSecond": 155.2
  },
  "burstMs": 374,
  "sse": {
    "attempted": 200,
    "opened": 200,
    "firstFrames": 200,
    "pings": 600,
    "revisions": 70,
    "errors": [],
    "startupMs": {
      "n": 200,
      "p50": 474,
      "p95": 533.7,
      "p99": 536.7,
      "max": 537
    }
  },
  "db": {
    "samples": 148,
    "peakTotalConnections": 11,
    "peakOtherConnections": 10,
    "peakActiveConnections": 3,
    "maxConnections": 100,
    "sampleErrors": 0
  },
  "errors": [],
  "limitations": [
    "Local production build, loopback network and local Postgres only; not proof of Railway/production capacity.",
    "Sparse datasets do not represent mature workspaces or large response payloads.",
    "HTTP load reads HTML bodies without downloading browser subresources/hydrating JavaScript; browser behavior is separate QA.",
    "GET-only application workload plus local fixture revision updates; no signup/bcrypt, crawl, AI, provider quotas, worker backlog, publishing, email or Stripe/payment capacity tested.",
    "200 active sessions use one SSE connection each plus mixed GETs around once per1–1.5seconds; not200 simultaneous expensive requests continuously.",
    "Configured app pool max10 per process; sampled other connections may include separate Next route bundles/processes and are reported without assuming a10-connection ceiling."
  ]
}
```

# Local production HTTP capacity test

PASS. Run command: DATABASE_URL=<dedicated local DB> npx tsx .factory/production-launch/qa/load.mts. No remote target is accepted.

```json
{
  "verdict": "PASS",
  "run": "load-1793652780205-62b1f9",
  "startedAt": "2026-11-02T20:53:00.206Z",
  "finishedAt": "2026-11-02T20:53:37.799Z",
  "target": "http://127.0.0.1:3901",
  "testedBuild": {
    "directory": ".next-launch-release",
    "buildId": "NNH2Klc26NzUsej_cYYXV"
  },
  "environment": {
    "node": "v22.18.0",
    "platform": "darwin",
    "architecture": "arm64",
    "logicalCpus": 10,
    "memoryGiB": 32,
    "sessions": 200,
    "uniqueBusinesses": 200,
    "worker": false,
    "billing": "off (server launch configuration supplied by PM)",
    "fixtures": "sparse active businesses; direct DB sessions, no password hashing/signin capacity claim"
  },
  "checks": {
    "noFatal": true,
    "noHttpOrTenancyErrors": true,
    "all200Streams": true,
    "atLeastThreePingsPerStreamAverage": true,
    "streamRevisionDelivery": true,
    "noUnexpectedStreamErrors": true,
    "sustainedP95Under2000ms": true,
    "sustainedP99Under5000ms": true,
    "actualDurationAtLeast35sec": true,
    "dbSamplerHealthy": true,
    "scopedFixturesRemoved": true
  },
  "groups": {
    "preflight": {
      "n": 1,
      "p50": 52.7,
      "p95": 52.7,
      "p99": 52.7,
      "max": 52.7,
      "errors": 0
    },
    "me": {
      "n": 2846,
      "p50": 7.1,
      "p95": 45.8,
      "p99": 397.1,
      "max": 417,
      "errors": 0
    },
    "burst": {
      "n": 200,
      "p50": 285.9,
      "p95": 324.8,
      "p99": 329.3,
      "max": 329.9,
      "errors": 0
    },
    "cross-tenant-denied": {
      "n": 10,
      "p50": 11.9,
      "p95": 12.7,
      "p99": 12.7,
      "max": 12.7,
      "errors": 0
    },
    "public": {
      "n": 559,
      "p50": 15.3,
      "p95": 119.6,
      "p99": 384.1,
      "max": 389,
      "errors": 0
    },
    "workspace": {
      "n": 2266,
      "p50": 13.1,
      "p95": 101.1,
      "p99": 588.1,
      "max": 609.2,
      "errors": 0
    },
    "postflight": {
      "n": 1,
      "p50": 3.4,
      "p95": 3.4,
      "p99": 3.4,
      "max": 3.4,
      "errors": 0
    }
  },
  "sustained": {
    "n": 5670,
    "p50": 9.8,
    "p95": 86,
    "p99": 555.2,
    "max": 609.2,
    "elapsedMs": 36226,
    "requestsPerSecond": 156.5
  },
  "burstMs": 341,
  "sse": {
    "attempted": 200,
    "opened": 200,
    "firstFrames": 200,
    "pings": 600,
    "revisions": 70,
    "errors": [],
    "startupMs": {
      "n": 200,
      "p50": 427.2,
      "p95": 523.3,
      "p99": 526.4,
      "max": 526.6
    }
  },
  "db": {
    "samples": 147,
    "peakTotalConnections": 11,
    "peakOtherConnections": 10,
    "peakActiveConnections": 2,
    "maxConnections": 100,
    "sampleErrors": 0
  },
  "errors": [],
  "limitations": [
    "Local production build, loopback network and local Postgres only; not proof of Railway/production capacity.",
    "Sparse datasets do not represent mature workspaces or large response payloads.",
    "HTTP load reads HTML bodies without downloading browser subresources/hydrating JavaScript; browser behavior is separate QA.",
    "GET-only application workload plus local fixture revision updates; no signup/bcrypt, crawl, AI, provider quotas, worker backlog, publishing, email or Stripe/payment capacity tested.",
    "200 active sessions use one SSE connection each plus mixed GETs around once per1–1.5seconds; not200 simultaneous expensive requests continuously.",
    "Configured app pool max10 per process; sampled other connections may include separate Next route bundles/processes and are reported without assuming a10-connection ceiling."
  ]
}
```

Exact-deliverable provenance for run `load-1793652780205-62b1f9`: HEAD verified immediately before execution as `1f6a1a1b14f5ae298bd188fa47c3d6dfa11e87f9`; PM supplied successful production build `.next-launch-release`, BUILD_ID verified from local file `NNH2Klc26NzUsej_cYYXV`, served at127.0.0.1:3901. All required checks PASS:5670timedGETs/36.226s=156.5req/s, p95~86ms/p99~555ms,200authenticated distinct-business sessions+200SSE,600pings/70revision events, zero unexpected HTTP/tenant/stream errors,10cross-tenant404checks, peak10appDBconnections+1sampler, ownfixtures removed. No application source edits, worker/provider/payment calls or production/backup actions in this verification. Same documented local/sparse/GET-only limitations apply.
