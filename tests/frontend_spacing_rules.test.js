/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const scriptPath = path.resolve(__dirname, '../static/script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Expose internals
scriptContent += `
window.createIsland = createIsland;
window.shouldAddSpace = shouldAddSpace;
window.convertIslandsForInference = convertIslandsForInference;
window.state = state;
window.handleChord = handleChord;
window.updateDisplay = updateDisplay;
window.resetState = () => { state.islands = []; state.candidates = []; };
`;

describe('Frontend Spacing Rules', () => {
    beforeAll(() => {
        document.body.innerHTML = '<div id="text-display"></div><textarea id="text-input" style="display:none"></textarea><div id="candidate-area"></div>';
        try {
            eval(scriptContent);
        } catch (e) {
            // It might fail if functions are not defined yet, which is expected before implementation
            console.error("Script evaluation error (expected before impl):", e);
        }
    });

    // Helper to create island objects matches the implementation plan
    const V = (val) => ({ type: 'vietnamese', value: val });
    const P = (val) => ({ type: 'punctuation', value: val });
    const C = (val) => ({ type: 'capital', value: val });
    const S = (val) => ({ type: 'spacing', value: val });

    test('shouldAddSpace: Viet -> Viet (Space)', () => {
        expect(window.shouldAddSpace(V("Xin"), V("chao"))).toBe(true);
    });

    test('shouldAddSpace: Viet -> Punct (No)', () => {
        expect(window.shouldAddSpace(V("Xin"), P("."))).toBe(false);
    });

    test('shouldAddSpace: Viet -> Capital (Space)', () => {
        expect(window.shouldAddSpace(V("Xin"), C("A"))).toBe(true);
    });

    test('shouldAddSpace: Punct -> Viet (Space)', () => {
        expect(window.shouldAddSpace(P("."), V("Xin"))).toBe(true);
    });

    test('shouldAddSpace: Punct -> Punct (No)', () => {
        expect(window.shouldAddSpace(P("."), P(","))).toBe(false);
    });

    test('shouldAddSpace: Punct -> Capital (Space)', () => {
        expect(window.shouldAddSpace(P("."), C("A"))).toBe(true);
    });

    test('shouldAddSpace: Capital -> Capital (No)', () => {
        expect(window.shouldAddSpace(C("U"), C("S"))).toBe(false);
    });

    test('shouldAddSpace: Capital -> Viet (No)', () => {
        expect(window.shouldAddSpace(C("T"), V("he"))).toBe(false);
    });

    test('shouldAddSpace: Capital -> Punct (No)', () => {
        expect(window.shouldAddSpace(C("U"), P("."))).toBe(false);
    });

    test('shouldAddSpace: Spacing involved (No)', () => {
        expect(window.shouldAddSpace(S(" "), V("Xin"))).toBe(false);
        expect(window.shouldAddSpace(V("Xin"), S(" "))).toBe(false);
        expect(window.shouldAddSpace(S(" "), S(" "))).toBe(false);
    });

    test('convertIslandsForInference: Merges Fixed Text', () => {
        // [Viet(Xin), Space, Viet(chao), Punct(.)] -> [Fixed("Xin chao.")]
        const input = [V("Xin"), S(" "), V("chao"), P(".")];
        const output = window.convertIslandsForInference(input);
        expect(output).toEqual(["Xin chao."]);
    });

    test('convertIslandsForInference: Handles V7 Boundaries', () => {
        // [Viet(Xin), Space, V7(na0)] -> [Fixed("Xin "), V7("na0"), Fixed("")]
        const input = [V("Xin"), S(" "), { type: 'vietnamese', value: 'na0', isV7: true }];
        const output = window.convertIslandsForInference(input);
        expect(output).toEqual(["Xin ", "na0", ""]);
    });

    test('convertIslandsForInference: Handles V7 -> Viet Space', () => {
        // [V7(na0), Viet(chao)] -> [Fixed(""), V7("na0"), Fixed(" chao")]
        // Because Viet follows Viet (V7 is Viet type), we need space.
        // It should be prepended to the next Fixed island.
        const input = [{ type: 'vietnamese', value: 'na0', isV7: true }, V("chao")];
        const output = window.convertIslandsForInference(input);
        // Server expects: [Fixed, V7, Fixed, V7...]
        // Index 0 is Fixed. V7 is Index 1.
        // So: ["", "na0", " chao"]
        expect(output).toEqual(["", "na0", " chao"]);
    });
});
