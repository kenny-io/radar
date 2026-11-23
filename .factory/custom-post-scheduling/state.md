# State — custom post scheduling

Base: main 467749c7 · branch kenny-dev/thally-custom-post-scheduling-dfb0dc

| Task | Owner | Status | Covers | Depends |
|---|---|---|---|---|
| A1 Architecture + UI design | factory-architect | verified (architecture.md, design.md; D1–D6 accepted) | C1–C11 | — |
| E1 Server contract, actions, upload route, guards | factory-engineer | active (owns src/lib contracts, src/server, src/app/api, docs) | C3–C8 | A1 |
| E2 Composer UI + PackView changes | factory-engineer | active (owns src/features/social, radar.css) | C1–C3, C7, C9–C11 | A1, E1 contracts |
| Q1 Independent QA (browser, stubs) | factory-qa | planned | all | E1, E2 |

Environment: throwaway Homebrew Postgres on 127.0.0.1:55432 (scratchpad), `RADAR_DEV_STUBS=1`, `RADAR_SOCIAL_PUBLISHING=all`.

Next action: review A1 output, then dispatch engineers.
