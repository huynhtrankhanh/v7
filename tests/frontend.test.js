
/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

// Read the script content
const scriptPath = path.resolve(__dirname, '../static/script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Append code to expose functions to window for testing
scriptContent += `
window.getV7FromStroke = getV7FromStroke;
window.consonantIntMap = consonantIntMap;
`;

describe('V7 Frontend Logic', () => {
    beforeAll(() => {
        // Mock DOM elements required by script.js to avoid errors during initial run
        document.body.innerHTML = `
            <div id="text-display"></div>
            <div id="candidate-area"></div>
        `;
        
        // Execute the script in the global context
        // We use function constructor or eval. Eval is simpler here.
        // We need to suppress "const" re-declaration errors if this was run multiple times,
        // but Jest runs this file once.
        try {
            eval(scriptContent);
        } catch (e) {
            console.error("Error evaluating script.js:", e);
        }
    });

    test('Consonant Map: c -> k (Code 5)', () => {
        // Stroke construction for "k":
        // k corresponds to bits 1 (#) and 4 (T). 1+4 = 5.
        // Left keys: # (Q), T (W).
        // Plus a vowel to make it valid. Vowel A (C).
        // Order in stroke string: #, S, T...
        // So string should contain "#T".
        // We add "*" to separate left/right.
        const stroke = "#TA*";
        const code = window.getV7FromStroke(stroke);
        
        // Expected: Consonant 5 -> "k".
        // Vowel A -> "a".
        // Tone 0.
        // Right side empty -> Consonant 0 ("0"), Vowel e ("e"), Tone 0.
        // Result: "ka00e0"
        
        expect(code).not.toBeNull();
        expect(code.substring(0, 2)).toBe("ka");
    });

    test('Consonant Map: đ -> dd (Code 7)', () => {
        // dd corresponds to bits 1 (#) + 2 (S) + 4 (T). 1+2+4 = 7.
        // Left keys: #, S, T.
        // Vowel A.
        // Stroke: "#STA*"
        const stroke = "#STA*";
        const code = window.getV7FromStroke(stroke);
        
        expect(code).not.toBeNull();
        expect(code.substring(0, 3)).toBe("dda");
    });

    test('Consonant Map: gi -> z (Code 30)', () => {
        // z corresponds to bits 2 (S) + 4 (T) + 8 (P) + 16 (H).
        // Left keys: S, T, P, H.
        // Vowel A.
        // Stroke: "STPHA*"
        const stroke = "STPHA*";
        const code = window.getV7FromStroke(stroke);
        
        expect(code).not.toBeNull();
        expect(code.substring(0, 2)).toBe("za");
    });

    test('Consonant Map: qu -> w (Code 3)', () => {
        // w corresponds to bits 1 (#) + 2 (S).
        // Left keys: #, S.
        // Vowel A.
        // Stroke: "#SA*"
        const stroke = "#SA*";
        const code = window.getV7FromStroke(stroke);
        
        expect(code).not.toBeNull();
        expect(code.substring(0, 2)).toBe("wa");
    });

    test('Consonant Map: Vowel Start -> 0 (Code 0)', () => {
        // 0 corresponds to 0 bits.
        // Left keys: None.
        // Vowel A.
        // Stroke: "A*"
        const stroke = "A*";
        const code = window.getV7FromStroke(stroke);
        
        expect(code).not.toBeNull();
        expect(code.substring(0, 2)).toBe("0a");
    });
    
    test('Consonant Int Map verification directly', () => {
        const map = window.consonantIntMap;
        expect(map[5]).toBe("k");
        expect(map[7]).toBe("dd");
        expect(map[30]).toBe("z");
        expect(map[3]).toBe("w");
        expect(map[0]).toBe("0");
    });
});
