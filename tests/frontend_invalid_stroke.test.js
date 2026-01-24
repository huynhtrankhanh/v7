
/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

// Read the script content
const scriptPath = path.resolve(__dirname, '../static/script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Append code to expose functions and state to window for testing
scriptContent += `
window.handleChord = handleChord;
window.getState = () => state;
window.getHistory = () => history;
window.setState = (s) => { state = s; };
window.resetHistory = () => { history = []; };
// Mock fetch to avoid errors
window.fetch = jest.fn(() => Promise.resolve({
    json: () => Promise.resolve({ candidates: [] })
}));
`;

describe('V7 Frontend Invalid Stroke Handling', () => {
    beforeAll(() => {
        document.body.innerHTML = `
            <div id="text-display"></div>
            <div id="candidate-area"></div>
        `;
        try {
            eval(scriptContent);
        } catch (e) {
            console.error("Error evaluating script.js:", e);
        }
    });

    beforeEach(() => {
        window.setState({ islands: [""], candidates: [] });
        window.resetHistory();
        window.fetch.mockClear();
    });

    test('Valid fixed text stroke saves state', () => {
        // "T" maps to "t", "A" maps to "a". "TA" is valid "ta".
        // Stroke: "TA" (Left T + Left A) -> "w" + "c" keys -> "TA" stroke.
        // Wait, "T" in stroke string refers to steno key T.
        // Left T is "T-". Left A is "A".
        // In stroke string: "T" (Left T), "A" (Left A).
        // Let's use `qwertyToUnique` logic? No, `handleChord` takes the serialized stroke string.
        // Valid Stroke: "T" + "A".
        
        window.handleChord("TA");
        
        expect(window.getHistory().length).toBe(1);
        expect(window.fetch).toHaveBeenCalled();
    });

    test('Valid V7 stroke saves state', () => {
        // Valid V7 needs "*" and valid keys.
        // Left: # (Q), T (W). -> "k".
        // Vowel A (C).
        // Stroke: "#TA*"
        
        window.handleChord("#TA*");
        
        expect(window.getHistory().length).toBe(1);
        expect(window.fetch).toHaveBeenCalled();
    });

    test('Invalid stroke is ignored and does NOT save state', () => {
        // Invalid Stroke: Just "P" (Right T).
        // `parse("P")` -> Initial? No. Vowel? No.
        // `getV7FromStroke("P")` -> No "*" -> null.
        
        window.handleChord("P");
        
        expect(window.getHistory().length).toBe(0);
        expect(window.fetch).not.toHaveBeenCalled();
    });

    test('Invalid V7 stroke (bad keys) is ignored', () => {
        // Stroke with "*", but garbage keys.
        // "XYZ*" -> parse fails (no XYZ keys).
        // getV7FromStroke -> Left "XYZ". No mapping for "XYZ" sum.
        // Actually, logic sums bits. 
        // `lk` function checks includes. "X", "Y", "Z" not in map -> bits 0.
        // cA = 0.
        // consonantIntMap[0] = "0" (from my fix).
        // So "XYZ*" might be interpreted as "0..."?
        
        // Wait, "XYZ" are not steno keys. `handleChord` receives stroke string.
        // Stroke string is built from `qwertyToUnique`.
        // If I pass "XYZ*" to `handleChord` manually?
        // `getV7FromStroke`: leftKeys="XYZ".
        // lk("#")=0, ... all 0. cA=0.
        // Consonant 0 is valid "0".
        // So "XYZ*" -> Consonant 0.
        // It might actually be valid 0?
        
        // Let's try a stroke that produces INVALID consonant index.
        // Need bit sum that is NOT in map.
        // Map has:
        // 0, 3(qu), 5(k), 7(d), 11(b), 7(dd-Wait), etc.
        // Let's find a gap.
        // Bits: 1(#), 2(S), 4(T), 8(P), 16(H). Max 31.
        // Map entries:
        // 2*4+3 = 11 (b)
        // 1*4+1 = 5 (k)
        // ...
        // Let's try just "P" (8) + "H" (16) = 24.
        // Is 24 in map?
        // 24 = 6*4. 6*4+0 = 24 ("m").
        // So "PH" is "m".
        
        // Let's try "S" (2).
        // Is 2 in map?
        // 2 is not in map. 3 is "w" (qu).
        // So just "S" (key S-) -> 2.
        // Invalid consonant?
        // Let's check `consonantIntMap` keys in script.js.
        // ...
        // So "S*" -> Left "S" -> cA=2.
        // `consonantIntMap[2]` is undefined?
        // `consonantIntMap[3]` is "w".
        // `consonantIntMap[2*4+1]` = 9 ("v").
        // It seems likely 2 is undefined.
        
        window.handleChord("S*");
        
        expect(window.getHistory().length).toBe(0);
        expect(window.fetch).not.toHaveBeenCalled();
    });
});
