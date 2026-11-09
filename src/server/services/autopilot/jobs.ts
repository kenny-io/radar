import { defineJob } from '@/server/jobs/queue';
import { defineCron } from '@/server/jobs/cron';
import { runAutopilot, autopilotTick, type RunPayload } from './run';
import { deliverHandoff, type HandoffPayload } from './handoff';
defineJob<RunPayload>({ kind: 'autopilot.run', maxAttempts: 3, timeoutMs: 15 * 60_000, run: runAutopilot });
defineJob<HandoffPayload>({ kind: 'autopilot.handoff', maxAttempts: 4, timeoutMs: 60_000, run: deliverHandoff });
defineCron('autopilot', autopilotTick);
