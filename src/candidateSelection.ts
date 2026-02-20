const candidateSelectionMap: Record<string, number> = {
    "-T": 0,
    "-TS": 1,
    "-S": 2,
    "-D": 3,
    "-Z": 4
};
const HYPHEN_PREFIX_LENGTH = 1;

const candidateSelectionSuffixes = Object.keys(candidateSelectionMap).sort((a, b) => b.length - a.length);

export type CandidateSelectionMatch = {
    candidateIndex: number;
    syllableStroke: string | null;
};

export function getCandidateSelectionMatch(stroke: string): CandidateSelectionMatch | null {
    const loneCandidateIndex = candidateSelectionMap[stroke];
    if (loneCandidateIndex !== undefined) {
        return { candidateIndex: loneCandidateIndex, syllableStroke: null };
    }

    for (const suffix of candidateSelectionSuffixes) {
        const rightHandSuffix = suffix.slice(HYPHEN_PREFIX_LENGTH);
        if (!stroke.endsWith(rightHandSuffix)) continue;
        const syllableStroke = stroke.slice(0, -rightHandSuffix.length);
        if (!syllableStroke || syllableStroke.endsWith("-")) continue;
        return {
            candidateIndex: candidateSelectionMap[suffix],
            syllableStroke
        };
    }

    return null;
}
