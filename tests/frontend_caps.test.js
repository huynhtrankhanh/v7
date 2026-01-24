
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
window.resetState = () => { state.islands = [""]; state.candidates = []; };
// Mock fetch
window.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ candidates: [] }) }));
`;

describe('Frontend Capitalization Feature', () => {
    beforeAll(() => {
        document.body.innerHTML = '<div id="text-display"></div><div id="candidate-area"></div>';
        eval(scriptContent);
    });

    beforeEach(() => {
        window.resetState();
        window.fetch.mockClear();
    });

    test('Fixed text stroke without # is lowercase', () => {
        // Stroke: "TA" -> "ta"
        window.handleChord("TA");
        expect(window.state.islands[0]).toBe("ta ");
    });

    test('Fixed text stroke WITH # is Capitalized', () => {
        // Stroke: "#TA" -> "Ta"
        window.handleChord("#TA");
        expect(window.state.islands[0]).toBe("Ta ");
    });

    test('Complex syllable with #', () => {
        // Stroke: "T" (Left T) + "P" (Right T) is invalid?
        // Let's use known valid: "H" (h) + "A" (a) + "S" (Huyền).
        // Stroke: "HAS".
        // With #: "#HAS". -> "Hà"
        window.handleChord("#HAS");
        expect(window.state.islands[0]).toBe("Hà ");
    });
});
