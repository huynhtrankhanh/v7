/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

// Read script.js content
const scriptPath = path.resolve(__dirname, '../static/script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Expose internal functions and state for testing
scriptContent += '\n' +
    'window.handleChord = handleChord;\n' +
    'window.state = state;\n' +
    'window.isRawMode = () => isRawMode;\n' +
    'window.updateDisplay = updateDisplay;\n' +
    'window.history = history;\n';

// Helper to wait
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Frontend Logic Issues Reproduction', () => {
    beforeEach(() => {
        // Reset DOM
        document.body.innerHTML =
            '<div id="text-display"></div>' +
            '<textarea id="text-input" style="display:none"></textarea>' +
            '<div id="candidate-area"></div>';
        
        // Mock fetch
        window.fetch = jest.fn().mockResolvedValue({
            json: async () => ({ candidates: [["Candidate1"], ["Candidate2"]] })
        });

        jest.resetModules();
        try {
            eval(scriptContent);
        } catch (e) {
            console.error("Eval error:", e);
        }
    });

    test('Issue 1: Escape hatch #S- should activate raw mode', () => {
        // Current implementation expects "#S-" but key serializer might produce "#S"
        const eventQ = new KeyboardEvent('keydown', { key: 'q' }); // #
        const eventA = new KeyboardEvent('keydown', { key: 'a' }); // S-
        document.dispatchEvent(eventQ);
        document.dispatchEvent(eventA);
        
        const eventQ_Up = new KeyboardEvent('keyup', { key: 'q' });
        const eventA_Up = new KeyboardEvent('keyup', { key: 'a' });
        document.dispatchEvent(eventQ_Up);
        document.dispatchEvent(eventA_Up);
        
        expect(window.isRawMode()).toBe(true); 
    });

    test('Issue 4: Punctuation should select candidate first', async () => {
        // 1. Enter V7 island
        window.handleChord("T*");
        await sleep(10);
        
        // 2. Enter Punctuation (Period: TP-PL)
        window.handleChord("TP-PL");
        
        // Expect candidates to be cleared
        expect(window.state.candidates.length).toBe(0);
        // Expect text to contain candidate and punctuation
        // Note: islands[0] is Fixed text.
        // If V7 was resolved, it merges into islands[0] (or islands ends up as single item)
        // We check if the text "Candidate1. " is present in the first island
        expect(window.state.islands[0]).toContain("Candidate1. ");
    });

    test('Issue 3: Newline leading to whitespace', () => {
        window.state.islands = ["Line1\n", "Line2"];
        window.state.candidates = [];
        window.updateDisplay();
        
        const display = document.getElementById("text-display");
        const content = display.textContent;
        // Logic puts space between islands.
        expect(content).not.toContain("\n ");
        expect(content).toContain("Line1\n[Line2]");
    });
    
    test('Issue 2: Cursor position', () => {
        window.state.islands = ["" ];
        window.state.candidates = [];
        window.updateDisplay();
        
        const display = document.getElementById("text-display");
        const children = display.childNodes;
        
        let cursorIndex = -1;
        let placeholderIndex = -1;
        
        for(let i=0; i<children.length; i++) {
            if (children[i].id === 'cursor') cursorIndex = i;
            if (children[i].nodeType === 1 && children[i].tagName === 'SPAN' && children[i].id !== 'cursor') placeholderIndex = i;
        }
        
        // Should be at start
        if (placeholderIndex !== -1) {
            expect(cursorIndex).toBeLessThan(placeholderIndex);
        }
    });
});