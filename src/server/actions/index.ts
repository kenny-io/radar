import type { ActionMap } from './define';
import { actions as profile } from './profile';
import { actions as onboarding } from './onboarding';
import { actions as calendar } from './calendar';
import { actions as article } from './article';
import { actions as publishing } from './publishing';
import { actions as social } from './social';
import { actions as socialPublish } from './socialPublish';
import { actions as brief } from './brief';
import { actions as performance } from './performance';
import { actions as visibility } from './visibility';
import { actions as backlinks } from './backlinks';
import { actions as team } from './team';
import { actions as settings } from './settings';
import { actions as core } from './core';

export const ACTIONS: ActionMap = { ...core, ...profile, ...onboarding, ...calendar, ...article, ...publishing, ...social, ...socialPublish, ...brief, ...performance, ...visibility, ...backlinks, ...team, ...settings };
