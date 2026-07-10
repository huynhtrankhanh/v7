/* tslint:disable */
/* eslint-disable */

export function buildCandidateDiffPlanJson(islands_json: string, candidates_json: string, limit: number): string;

export function buildCandidateTextDiffPlanJson(candidate_texts_json: string): string;

export function convertIslandsForInferenceJson(islands_json: string): string;

export function findPiecemealSyllableTargetsJson(islands_json: string, valid_syllables_json: string): string;

export function getCandidateSelectionMatchJson(stroke: string, candidate_count: number): string;

export function getNextPiecemealCursorIndexJson(current_index: number, next_target_count: number): string;

export function getPiecemealEntryIndexJson(stroke: string): string;

export function getSelectedCandidateTextJson(candidates_json: string, index: number, islands_json?: string | null): string;

export function mapKeyUnique(key: string): string | undefined;

export function renderVisibleTextJson(islands_json: string, candidates_json: string): string;

export function replacePiecemealSyllableJson(islands_json: string, target_json: string, replacement: string): string;

export function selectCandidateIslandsJson(candidates_json: string, index: number, islands_json?: string | null): string;

export function serializeStrokeKeysJson(stroke_keys_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly buildCandidateDiffPlanJson: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly buildCandidateTextDiffPlanJson: (a: number, b: number) => [number, number, number, number];
    readonly convertIslandsForInferenceJson: (a: number, b: number) => [number, number, number, number];
    readonly findPiecemealSyllableTargetsJson: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly getCandidateSelectionMatchJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly getNextPiecemealCursorIndexJson: (a: number, b: number) => [number, number, number, number];
    readonly getPiecemealEntryIndexJson: (a: number, b: number) => [number, number, number, number];
    readonly getSelectedCandidateTextJson: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly mapKeyUnique: (a: number, b: number) => [number, number];
    readonly renderVisibleTextJson: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly replacePiecemealSyllableJson: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly selectCandidateIslandsJson: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly serializeStrokeKeysJson: (a: number, b: number) => [number, number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
