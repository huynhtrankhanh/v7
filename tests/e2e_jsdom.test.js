
/**
 * @jest-environment jsdom
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_BIN = path.resolve(__dirname, '../inference-rs/target/release/inference-rs');
const MODEL_PATH = path.resolve(__dirname, '../lm.binary');
const STATIC_DIR = path.resolve(__dirname, '../static');
const PORT = 3002;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

// Read script.js content
const scriptPath = path.resolve(__dirname, '../static/script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');

// 1. Replace relative URL with absolute URL for test environment
scriptContent = scriptContent.replace('fetch("/infer"', `fetch("${BASE_URL}/infer"`);

// 1b. Inject hook for malformed code test
scriptContent = scriptContent.replace(
    'function getV7FromStroke(stroke) {',
    'function getV7FromStroke(stroke) { if (stroke === "FORCE_FAIL*") return "MALFORMED_CODE_XYZ";'
);

// 2. Expose handleChord for easier testing
scriptContent += `
window.handleChord = handleChord;
window.state = state;
`;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Global setup for this test file
beforeAll(async () => {
    console.log("Starting server for E2E JSDOM test...");
    serverProcess = spawn(SERVER_BIN, [
        '--server',
        '--port', PORT.toString(),
        '--static-dir', STATIC_DIR,
        '--model-path', MODEL_PATH
    ]);

    // Wait for server to be ready
    await sleep(2000);

    // Setup JSDOM environment
    
    // Polyfill fetch with node-fetch
    window.fetch = require('node-fetch');

    // DOM Setup
    document.body.innerHTML = `
        <div id="text-display"></div>
        <textarea id="text-input" style="display:none"></textarea>
        <div id="candidate-area"></div>
    `;

    // Load the script
    try {
        eval(scriptContent);
        
        // Monkey-patch getV7FromStroke to simulate a stroke that produces a malformed V7 code
        // This allows us to verify the server's error handling and the client's fallback UI
        const originalGetV7 = window.getV7FromStroke;
        window.getV7FromStroke = (stroke) => {
            if (stroke === "FORCE_FAIL*") {
                return "MALFORMED_CODE_XYZ"; 
            }
            return originalGetV7(stroke);
        };
        
    } catch (e) {
        console.error("Error evaluating script.js:", e);
    }
}, 10000);

afterAll(() => {
    if (serverProcess) {
        console.log("Stopping server...");
        serverProcess.kill();
    }
});

describe('E2E Integration with Real Server', () => {
    test('Sending V7 stroke fetches candidates from server', async () => {
        // V7 Stroke: "TPHA*" -> "na0..."
        console.log("Simulating stroke 'TPHA*'...");
        window.handleChord("TPHA*");
        
        await sleep(500);
        
        const candidateArea = document.getElementById("candidate-area");
        const candidates = candidateArea.querySelectorAll('.candidate');
        expect(candidates.length).toBeGreaterThan(0);
        
        const firstCandText = candidates[0].querySelector('.candidate-text').textContent;
        console.log("First Candidate:", firstCandText);
        expect(firstCandText).toBeTruthy();
    });

    test('Sending malformed V7 code triggers fallback display', async () => {
        // Send the stroke that triggers our monkey-patch
        console.log("Simulating malformed stroke 'FORCE_FAIL*'...");
        window.handleChord("FORCE_FAIL*");
        
        await sleep(500);
        
        const textDisplay = document.getElementById("text-display");
        const text = textDisplay.textContent;
        console.log("Text:", text);
        
        // Expect: previous text + [MALFORMED_CODE_XYZ]
        // Note: Previous test appended text. State is preserved.
        expect(text).toContain("[MALFORMED_CODE_XYZ]");
    });
});
