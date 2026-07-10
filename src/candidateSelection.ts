import { requireUiCoreProvider } from "./uiCoreProvider";

export type CandidateSelectionMatch = {
    candidateIndex: number;
    syllableStroke: string | null;
};

export function getCandidateSelectionMatch(stroke: string, candidateCount = Number.POSITIVE_INFINITY): CandidateSelectionMatch | null {
    return requireUiCoreProvider().getCandidateSelectionMatch(stroke, candidateCount);
}

export function getFirstCandidateAppendStroke(stroke: string): string | null {
    const match = getCandidateSelectionMatch(stroke);
    if (!match || match.candidateIndex !== 0 || match.syllableStroke === null) {
        return null;
    }
    return match.syllableStroke;
}

export function isLoneCandidateSelectionStroke(stroke: string): boolean {
    const match = getCandidateSelectionMatch(stroke);
    return !!match && match.syllableStroke === null;
}
