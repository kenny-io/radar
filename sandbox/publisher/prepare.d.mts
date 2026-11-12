// Types for prepare.mjs, so Radar's TypeScript tests can import the runner script.
export interface PrepareLimits { archiveBytes: number; expandedEntries: number; expandedBytes: number; baselineBytes: number; pathBytes: number }
export declare const PREPARE_LIMITS: Readonly<PrepareLimits>;
export declare const SESSION_FILE: string;
export declare const EXIT: Readonly<{ ok: 0; failed: 1; tooLarge: 3 }>;
export interface ExtractionSummary { entries: number; files: number; bytes: number; skipped: number }
export declare function prepareError(code: string): Error;
export declare function boundedToken(value: unknown, fallback?: string): string;
export declare function outputLine(text: string): string;
export declare function isUnsafeArchivePath(path: unknown): boolean;
export declare function extractArchive(input: { archive: string; destination: string; limits?: { expandedEntries: number; expandedBytes: number } }): Promise<ExtractionSummary>;
export declare function gitBlobSha1(absolutePath: string): Promise<{ sha: string; bytes: number } | null>;
export declare function walkRegularFiles(root: string, options?: { maxEntries?: number }): AsyncGenerator<{ path: string; absolute: string }>;
export declare function buildBaseline(root: string): Promise<{ entries: Record<string, string>; files: number; bytes: number }>;
export declare function writeBaseline(baselinePath: string, entries: Record<string, string>, maxBytes?: number): Promise<void>;
export declare function describePreparationFailure(error: unknown): { line: string; exitCode: number };
export declare function prepareWorkspace(paths?: { archive?: string; repo?: string; outputDir?: string; baseline?: string; session?: string; limits?: PrepareLimits }): Promise<ExtractionSummary>;
