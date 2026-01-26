
/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const scriptPath = path.resolve(__dirname, '../static/script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');
scriptContent += `
window.parse = parse;
window.assemble = assemble;
window.handleChord = handleChord;
window.state = state;
window.createIsland = createIsland;
window.resetState = () => { state.islands = [createIsland('vietnamese', '')]; state.candidates = []; };
// Mock fetch
window.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ candidates: [] }) }));
`;

describe('Frontend Capitalization Feature', () => {
    beforeAll(() => {
        document.body.innerHTML = '<div id="text-display"></div><textarea id="text-input" style="display:none"></textarea><div id="candidate-area"></div>';
        eval(scriptContent);
    });

    beforeEach(() => {
        window.resetState();
        window.fetch.mockClear();
    });

    test('Fixed text stroke without # is lowercase', () => {
        // Stroke: "TA" -> "ta"
        window.handleChord("TA");
        // Initial state is [Viet("")], append pushes [Viet("ta")]
        // So index 1
        expect(window.state.islands[window.state.islands.length - 1].value).toBe("ta");
    });

    test('Fixed text stroke WITH # is Capitalized', () => {
        // Stroke: "#TA" -> "Ta"
        window.handleChord("#TA");
        expect(window.state.islands[window.state.islands.length - 1].value).toBe("Ta");
    });

    test('Complex syllable with #', () => {
        // Stroke: "T" (Left T) + "P" (Right T) is invalid?
        // Let's use known valid: "H" (h) + "A" (a) + "S" (Huyền).
        // Stroke: "HAS".
        // With #: "#HAS". -> "Hà"
        window.handleChord("#HAS");
        expect(window.state.islands[window.state.islands.length - 1].value).toBe("Hà");
    });
});
