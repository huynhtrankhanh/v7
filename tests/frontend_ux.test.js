/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

// Read the script content
const scriptPath = path.resolve(__dirname, '../static/script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Append code to expose internals to window for testing
scriptContent += `
window.state = state;
window.createIsland = createIsland;
window.handleChord = handleChord;
window.updateDisplay = updateDisplay;
window.isRawMode = () => isRawMode; // Getter since it's a let
window.setIsRawMode = (val) => { isRawMode = val; };
window.getStenoHistory = () => history;
`;

describe('V7 Frontend UX', () => {
    let mockWriteText;

    beforeAll(() => {
        // Mock DOM
        document.body.innerHTML = `
            <div id="text-display">Type with your steno keyboard...</div>
            <textarea id="text-input" style="display:none"></textarea>
            <div id="candidate-area"></div>
        `;

        // Mock Clipboard
        mockWriteText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: {
                writeText: mockWriteText
            }
        });
        
        // Mock fetch for inference
        global.fetch = jest.fn(() =>
            Promise.resolve({
                json: () => Promise.resolve({ candidates: [['mocked']] }),
            })
        );

        // Execute script
        try {
            eval(scriptContent);
        } catch (e) {
            console.error("Error evaluating script.js:", e);
        }
    });
    
    beforeEach(() => {
        // Reset state
        window.state.islands = [window.createIsland('vietnamese', '')];
        window.state.candidates = [];
        window.getStenoHistory().length = 0;
        window.setIsRawMode(false);
        document.getElementById('text-display').textContent = "";
        document.getElementById('text-input').value = "";
        jest.clearAllMocks();
    });

    test('Escape Hatch (#S) triggers raw mode and clears undo', () => {
        // Setup initial state with some history
        window.state.islands = [window.createIsland('vietnamese', 'hello')];
        window.getStenoHistory().push("some_state");
        
        window.handleChord("#S-");
        
        expect(window.isRawMode()).toBe(true);
        expect(window.getStenoHistory().length).toBe(0);
        expect(document.getElementById('text-input').style.display).toBe('block');
        expect(document.getElementById('text-display').style.display).toBe('none');
        expect(document.getElementById('text-input').value).toBe("hello");
        expect(document.activeElement.id).toBe('text-input');
    });

    test('Esc key exits raw mode and updates state', () => {
        window.handleChord("#S-"); // Enter raw mode
        const textArea = document.getElementById('text-input');
        textArea.value = "hello world";
        
        // Simulate Esc keydown
        const event = new KeyboardEvent('keydown', { key: 'Escape' });
        document.dispatchEvent(event);
        
        expect(window.isRawMode()).toBe(false);
        expect(window.state.islands[0].value).toBe("hello world");
        expect(document.getElementById('text-display').style.display).toBe('block');
        // Undo should be empty upon exit
        expect(window.getStenoHistory().length).toBe(0);
    });

    test('Space stroke (S-P) adds space', () => {
        window.state.islands = [window.createIsland('vietnamese', 'hello')];
        window.handleChord("S-P");
        // [Viet('hello'), Space(' ')]
        expect(window.state.islands[1].type).toBe("spacing");
        expect(window.state.islands[1].value).toBe(" ");
    });

    test('Punctuation TP-PL adds dot and handles spacing', () => {
        window.state.islands = [window.createIsland('vietnamese', 'hello')];
        window.handleChord("TP-PL"); // Period
        // [Viet('hello'), Punct('.')]
        expect(window.state.islands[1].type).toBe("punctuation");
        expect(window.state.islands[1].value).toBe(".");
        // Spacing rules will render it as "hello." (no space before punct)
    });

    test('Ambiguous input does not block keystrokes', () => {
        window.state.candidates = [["cand1"], ["cand2"]];
        window.handleChord("TA");
        expect(window.state.islands[window.state.islands.length - 1].value).toBe("ta");
    });

    test('Enter key adds newline', () => {
        window.state.islands = [window.createIsland('vietnamese', 'line1')];
        const event = new KeyboardEvent('keydown', { key: 'Enter' });
        document.dispatchEvent(event);
        
        expect(window.state.islands[1].type).toBe("spacing");
        expect(window.state.islands[1].value).toBe("\n");
    });

    test('Shift+Letter appends literal uppercase', () => {
        window.state.islands = [window.createIsland('vietnamese', 'abc')];
        const event = new KeyboardEvent('keydown', { key: 'A', shiftKey: true });
        document.dispatchEvent(event);
        
        // [Viet('abc'), Cap('A')]
        expect(window.state.islands[1].type).toBe("capital");
        expect(window.state.islands[1].value).toBe("A");
    });

    test('Ctrl+C copies buffer', () => {
        window.state.islands = [window.createIsland('vietnamese', 'copy me')];
        // Mock selection to be empty
        window.getSelection = jest.fn().mockReturnValue({ toString: () => "" });
        
        const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true });
        document.dispatchEvent(event);
        
        expect(mockWriteText).toHaveBeenCalledWith("copy me");
    });
});
