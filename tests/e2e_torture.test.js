
/**
 * @jest-environment jsdom
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_BIN = path.resolve(__dirname, '../inference-rs/target/release/inference-rs');
const MODEL_PATH = path.resolve(__dirname, '../lm.binary');
const STATIC_DIR = path.resolve(__dirname, '../static');
const PORT = 3003;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;
const scriptPath = path.resolve(__dirname, '../static/script.js');
let scriptContent = fs.readFileSync(scriptPath, 'utf8');
scriptContent = scriptContent.replace('fetch("/infer"', `fetch("${BASE_URL}/infer"`);
scriptContent += `
window.handleChord = handleChord;
window.state = state;
`;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

beforeAll(async () => {
    console.log("Starting server for Torture Test...");
    serverProcess = spawn(SERVER_BIN, [
        '--server',
        '--port', PORT.toString(),
        '--static-dir', STATIC_DIR,
        '--model-path', MODEL_PATH
    ]);
    await sleep(2000);
    window.fetch = require('node-fetch');
    document.body.innerHTML = '<div id="text-display"></div><textarea id="text-input" style="display:none"></textarea><div id="candidate-area"></div>';
    try {
        eval(scriptContent);
    } catch (e) {
        console.error("Script eval failed:", e);
    }
}, 10000);

afterAll(() => {
    if (serverProcess) serverProcess.kill();
});

describe('E2E Torture Test', () => {
    test('Survives 100 random strokes', async () => {
        const keys = ["#", "S", "T", "K", "P", "W", "H", "R", "A", "O", "*", "E", "U", "F", "R", "P", "B", "L", "G", "T", "S", "D", "Z"];
        // Note: The stroke string expected by handleChord doesn't use "-", it uses raw keys but in order.
        // Wait, script.js: `strokeStr += k.replace("-", "")`.
        // So I should generate strokes using the set of characters that can appear in `strokeStr`.
        // `strokeStr` is concatenation of keys in `order`.
        // Order: #, S-, T-, K-, P-, W-, H-, R-, A, O, *, E, U, -F, -R, -P, -B, -L, -G, -T, -S, -D, -Z.
        // Resulting string chars: #, S, T, K, P, W, H, R, A, O, *, E, U, F, R, P, B, L, G, T, S, D, Z.
        // Note duplication: S, T, P, H, R exist on both sides.
        // `handleChord` receives a string like "STPHA*EU..."
        
        // I will generate random substrings from the full ordered set.
        const order = ["#", "S-", "T-", "K-", "P-", "W-", "H-", "R-", "A", "O", "*", "E", "U", "-F", "-R", "-P", "-B", "-L", "-G", "-T", "-S", "-D", "-Z"];
        
        for (let i = 0; i < 100; i++) {
            let stroke = "";
            // Randomly select keys respecting order (steno chords are ordered)
            for (const key of order) {
                if (Math.random() > 0.7) { // 30% chance to include a key
                    stroke += key.replace("-", "");
                }
            }
            if (stroke.length === 0) continue;
            
            // console.log(`Torture stroke ${i}: ${stroke}`);
            
            try {
                window.handleChord(stroke);
            } catch (e) {
                console.error(`Crash on stroke ${stroke}:`, e);
                throw e;
            }
            
            // Allow some time for async fetch, but we don't strictly need to wait for every single one to complete
            // unless we want to test overlapping requests (which is good torture).
            // We'll wait a tiny bit every 10 strokes to let things settle slightly.
            if (i % 10 === 0) await sleep(100);
        }
        
        // Final check: App should be alive
        await sleep(1000);
        const text = document.getElementById("text-display").textContent;
        console.log("Final text length:", text.length);
        console.log("Final text snippet:", text.substring(0, 100));
        
        expect(text).toBeDefined();
    }, 20000);
});
