type CandidateSelectionMatch = {
    index: number;
    remainingStroke: string;
};

const CANDIDATE_SELECTION_SUFFIXES = [
    { suffix: "TS", index: 1 },
    { suffix: "T", index: 0 },
    { suffix: "S", index: 2 },
    { suffix: "D", index: 3 },
    { suffix: "Z", index: 4 }
];

export function extractCandidateSelection(stroke: string): CandidateSelectionMatch | null {
    for (const { suffix, index } of CANDIDATE_SELECTION_SUFFIXES) {
        const hyphenatedSuffix = `-${suffix}`;

        if (stroke === hyphenatedSuffix) {
            return { index, remainingStroke: "" };
        }

        if (stroke.endsWith(hyphenatedSuffix) && stroke.length > hyphenatedSuffix.length) {
            return {
                index,
                remainingStroke: stroke.slice(0, -hyphenatedSuffix.length)
            };
        }

        if (stroke.endsWith(suffix) && stroke.length > suffix.length) {
            return {
                index,
                remainingStroke: stroke.slice(0, -suffix.length)
            };
        }
    }

    return null;
}
