/** Archived types remain readable for history, but can never create or retry a provider request. */
export const RETIRED_LIFECYCLE_TYPES = ['trial_ending', 'workspace_ready'] as const;
export const isRetiredLifecycle = (type: string) => (RETIRED_LIFECYCLE_TYPES as readonly string[]).includes(type);
