
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
window.updateDisplay = updateDisplay;
window.getState = () => state;
window.setState = (s) => { state = s; };
`;

describe('V7 Frontend UX', () => {
    beforeAll(() => {
        // Mock DOM elements
        document.body.innerHTML = `
            <div id="text-display"></div>
            <div id="candidate-area"></div>
        `;
        
        // Execute the script
        try {
            eval(scriptContent);
        } catch (e) {
            console.error("Error evaluating script.js:", e);
        }
    });

    test('updateDisplay shows brackets for V7 codes when candidates are empty', () => {
        // Setup state with no candidates and some islands
        const mockState = {
            islands: ["Hello ", "na0", " World ", "tro2"],
            candidates: []
        };
        
        window.setState(mockState);
        window.updateDisplay();
        
        const display = document.getElementById("text-display");
        const content = display.textContent;
        
        // Expect: "Hello [na0] World [tro2]"
        // Note: join("") was used. 
        // "Hello " + "[na0]" + " World " + "[tro2]"
        expect(content).toBe("Hello [na0] World [tro2]");
    });

    test('updateDisplay shows top candidate when candidates exist', () => {
        const mockState = {
            islands: ["Hello ", "na0"],
            candidates: [["Hello", "nay"]]
        };
        window.setState(mockState);
        window.updateDisplay();
        const display = document.getElementById("text-display");
        const content = display.textContent;
        expect(content).toBe("Hello nay");
    });
});
