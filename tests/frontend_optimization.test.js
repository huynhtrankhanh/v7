
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
window.runInference = runInference;
window.resetState = () => { state.islands = [createIsland('vietnamese', '')]; state.candidates = []; };
window.updateDisplay = updateDisplay;
// Mock fetch
window.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ candidates: [["mocked"]] }) }));
`;

describe('Frontend Optimization', () => {
    beforeAll(() => {
        document.body.innerHTML = '<div id="text-display"></div><textarea id="text-input" style="display:none"></textarea><div id="candidate-area"></div>';
        eval(scriptContent);
    });

    beforeEach(() => {
        window.resetState();
        window.fetch.mockClear();
    });

    test('Should NOT send inference request for fixed text only', async () => {
        // Append a fixed text island via handleChord
        // Stroke "TA" -> "ta" (fixed text)
        window.handleChord("TA");

        // Wait for potential async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        // Initial empty island + "ta"
        expect(window.state.islands.length).toBeGreaterThan(1);

        // The optimization should prevent fetch
        // NOTE: In current implementation, this SHOULD FAIL (fetch is called).
        // In fixed implementation, this should pass.
        expect(window.fetch).not.toHaveBeenCalled();

        // Candidates should be empty (treated as empty)
        expect(window.state.candidates.length).toBe(0);

        // Check display contains the text
        const display = document.getElementById("text-display");
        expect(display.textContent).toContain("ta");
    });

    test('Should send inference request when V7 island is present', async () => {
        // Manually inject V7 island to ensure we have one
        window.state.islands.push(window.createIsland('vietnamese', 'na0', true));

        // Call runInference
        await window.runInference();

        expect(window.fetch).toHaveBeenCalled();
    });
});
