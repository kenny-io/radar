// Types for agent-environment.mjs, so Radar's TypeScript tests can import the runner script.
export declare const TRANSPORT_VARIABLES: readonly string[];
export declare const AGENT_MAX_OUTPUT_TOKENS: number;
export declare function buildAgentEnvironment(environment: Record<string, string | undefined>): Record<string, string | undefined>;
