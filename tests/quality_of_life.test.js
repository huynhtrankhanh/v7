
/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

// Read the script content
const scriptPath = path.resolve(__dirname, '../static/script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Mock fetch for runInference
global.fetch = jest.fn(() =>
    Promise.resolve({
        json: () => Promise.resolve({ candidates: [] }),
    })
);

// Helper to reload script
function loadScript() {
    // Reset DOM
    document.body.innerHTML = `
        <div id="text-display"></div>
        <div id="candidate-area"></div>
    `;

    // Reset global state if exposed, but since script.js has top-level variables,
    // re-evaluating it re-declares them.
    // To allow re-evaluation, we might need to scope it or just rely on state reset functions if available.
    // However, script.js uses `let` at top level. Re-evaluating will throw SyntaxError: Identifier 'state' has already been declared.
    // So we can only eval once per test file execution usually.
    // We will rely on exposed functions to reset state.

    // We append code to expose state and functions
    const exposeCode = `
        window.state = state;
        window.scriptHistory = history;
        window.handleChord = handleChord;
        window.updateDisplay = updateDisplay;
        window.smartJoin = (typeof smartJoin !== 'undefined') ? smartJoin : null;
        if (typeof isTextareaMode !== 'undefined') {
            Object.defineProperty(window, 'isTextareaMode', {
                get: function() { return isTextareaMode; },
                set: function(val) { isTextareaMode = val; }
            });
        }
        window.resetState = () => {
            state.islands = [""];
            state.candidates = [];
            // Reset history
            history.length = 0;
            // Reset mode
            if(typeof isTextareaMode !== 'undefined') isTextareaMode = false;
        };
        window.simulateKeydown = (key, shift, ctrl) => {
             const event = new KeyboardEvent('keydown', { key: key, shiftKey: shift, ctrlKey: ctrl });
             document.dispatchEvent(event);
        };
        window.simulateKeyup = (key) => {
             const event = new KeyboardEvent('keyup', { key: key });
             document.dispatchEvent(event);
        };
    `;

    try {
        eval(scriptContent + exposeCode);
    } catch (e) {
        // Ignore re-declaration errors if we can't avoid them, but ideally we run once.
        if (!e.message.includes("has already been declared")) {
            console.error(e);
        }
    }
}

describe('Quality of Life Features', () => {
    beforeAll(() => {
        loadScript();
    });

    beforeEach(() => {
        if (window.resetState) window.resetState();
        document.getElementById("text-display").innerHTML = "";
        // Reset fetch mock
        global.fetch.mockClear();
        global.fetch.mockImplementation(() =>
             Promise.resolve({ json: () => Promise.resolve({ candidates: [] }) })
        );
    });

    test('Enter key appends newline', () => {
        // Trigger Enter
        window.simulateKeydown("Enter", false, false);

        // Check state
        expect(window.state.islands.length).toBeGreaterThan(0);
        // Depending on implementation, it might be in the last island
        const lastIsland = window.state.islands[window.state.islands.length - 1];
        expect(lastIsland).toContain("\n");
    });

    test('Shift + Letter appends literal', () => {
        // Trigger Shift + A
        window.simulateKeydown("A", true, false);

        const lastIsland = window.state.islands[window.state.islands.length - 1];
        expect(lastIsland).toContain("A");
    });

    test('Stroke S-P appends space', () => {
        // Simulate S-P stroke.
        // We can call handleChord("SP") directly as stroke string logic is complex to simulate via keys in test.
        window.handleChord("SP");

        const lastIsland = window.state.islands[window.state.islands.length - 1];
        expect(lastIsland).toContain(" ");
    });

    test('Punctuation TP-PL appends dot space', () => {
        window.handleChord("TPPL");

        // We expect ". "
        // But smartJoin might handle the space.
        // If implementation appends ". " to island:
        const lastIsland = window.state.islands[window.state.islands.length - 1];
        expect(lastIsland).toContain(". ");
    });

    test('Escape Hatch #S', () => {
        // Setup some state
        window.state.candidates = [["Candidate1"]];
        window.scriptHistory.push("SomeHistory");

        // Trigger #S
        window.handleChord("#S");

        // Check 1: Top candidate selected
        // selectCandidate(0) should have been called.
        // state.candidates should be empty.
        expect(window.state.candidates).toEqual([]);

        // Check 2: History cleared
        expect(window.scriptHistory.length).toBe(0);

        // Check 3: Textarea mode
        expect(window.isTextareaMode).toBe(true);

        // Check 4: DOM has textarea
        const textarea = document.querySelector("textarea");
        expect(textarea).not.toBeNull();
    });

    test('Smart Join logic (Unit)', () => {
        // We need to access smartJoin.
        if (window.smartJoin) {
            expect(window.smartJoin(["Hello", "World"])).toBe("Hello World");
            expect(window.smartJoin(["Hello ", "World"])).toBe("Hello World");
            expect(window.smartJoin(["Hello", " World"])).toBe("Hello World"); // If smartJoin handles leading space of right side?
            // Usually smartJoin handles joining.
        }
    });
});
