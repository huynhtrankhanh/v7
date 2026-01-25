
/**
 * @jest-environment jsdom
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_BIN = path.resolve(__dirname, '../inference-rs/target/release/inference-rs');
const MODEL_PATH = path.resolve(__dirname, '../lm.binary');
const STATIC_DIR = path.resolve(__dirname, '../static');
const PORT = 3003; // Use different port
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

const scriptPath = path.resolve(__dirname, '../static/script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Replace fetch url
scriptContent = scriptContent.replace('fetch("/infer"', `fetch("${BASE_URL}/infer"`);

// Expose handleChord
scriptContent += `
window.handleChord = handleChord;
window.state = state;
`;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

beforeAll(async () => {
    console.log("Starting server for Numbering Verification...");
    serverProcess = spawn(SERVER_BIN, [
        '--server',
        '--port', PORT.toString(),
        '--static-dir', STATIC_DIR,
        '--model-path', MODEL_PATH
    ]);

    await sleep(2000);

    window.fetch = require('node-fetch');

    document.body.innerHTML = `
        <div id="text-display"></div>
        <div id="candidate-area"></div>
    `;

    try {
        eval(scriptContent);
    } catch (e) {
        console.error("Error evaluating script.js:", e);
    }
}, 10000);

afterAll(() => {
    if (serverProcess) {
        serverProcess.kill();
    }
});

test('Candidates should display numbering (superscript)', async () => {
    // Send a stroke that produces candidates
    window.handleChord("TPHA*");
    await sleep(500);

    const candidates = document.querySelectorAll('.candidate');
    expect(candidates.length).toBeGreaterThan(0);

    const firstCand = candidates[0];
    const superscript = firstCand.querySelector('sup.candidate-number');

    expect(superscript).not.toBeNull();
    expect(superscript.textContent).toBe('1');

    if (candidates.length > 1) {
        const secondSup = candidates[1].querySelector('sup.candidate-number');
        expect(secondSup.textContent).toBe('2');
    }
});
