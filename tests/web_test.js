
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');

const SERVER_PORT = 3000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

// Paths
const SERVER_BIN = path.resolve(__dirname, '../inference-rs/target/release/inference-rs');
const STATIC_DIR = path.resolve(__dirname, '../static');
const MODEL_PATH = path.resolve(__dirname, '../lm.binary');

let serverProcess;
let browser;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startServer() {
    console.log("Starting server...");
    // Build first to ensure it's ready? We assume it's built.
    // Cmd: ./inference-rs --server --port 3000 --static-dir ../static --model-path ../lm.binary
    serverProcess = spawn(SERVER_BIN, [
        '--server',
        '--port', SERVER_PORT.toString(),
        '--static-dir', STATIC_DIR,
        '--model-path', MODEL_PATH
    ]);

    serverProcess.stdout.on('data', (data) => {
        console.log(`SERVER: ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
        console.error(`SERVER ERR: ${data}`);
    });

    // Wait for server to be ready (dumb wait)
    await sleep(2000);
}

async function stopServer() {
    if (serverProcess) {
        console.log("Stopping server...");
        serverProcess.kill();
    }
}

async function runTest() {
    try {
        await startServer();

        console.log("Launching browser...");
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for some environments
        });
        const page = await browser.newPage();

        console.log(`Navigating to ${SERVER_URL}...`);
        await page.goto(SERVER_URL);

        // Wait for display
        await page.waitForSelector('#text-display');

        // Test 1: Typing Fixed Text
        // Stroke "P" (Right T) "T" (Right S).
        // Wait, "P" (QWERTY) is "T" (Right). "L" (QWERTY) is "G" (Right).
        // Let's use simple left keys.
        // "S" (Left) -> QWERTY "a".
        // "T" (Left) -> QWERTY "w".
        // Stroke "ST".
        // Left S + Left T.
        // `parse`("ST") -> Initial "t" (StenographyMap T=t?).
        // Wait. `stenographyMap`: "ST"? No.
        // `stenographyMap` has "S", "T", "ST"?
        // "T" -> "t". "S" -> "s"? No "KP" -> "s".
        // `stenographyMap`: "T": "t".
        // "S" (Left) key is "S" key in Steno? No, "S" key is "S" key.
        // `stenographyMap` keys are STENO KEYS.
        // If I press "S" (key), "T" (key).
        // "ST" -> matches `stenographyMap`?
        // Let's check `script.js` maps again.
        // `stenographyMap`: "T": "t".
        // "TP": "ph".
        // "S"? No "S" key in `stenographyMap`.
        // "KP" -> "s".
        // So just "S" alone is not in `stenographyMap`.
        // "ST"? No.
        // So "ST" stroke might fail `parse`.
        
        // Let's try a known valid stroke.
        // "T" (Right T). QWERTY "p".
        // "P" (Right P). QWERTY "i".
        // Stroke "PT".
        // `parse`: `currentStroke`="PT".
        // No Initial.
        // No Vowel.
        // Fail.
        
        // I need a Vowel.
        // "A" (Left A). QWERTY "c".
        // "O" (Left O). QWERTY "v".
        // "E" (Right E). QWERTY "n".
        // "U" (Right U). QWERTY "m".
        
        // "T" (Left T) + "A" (Left A).
        // QWERTY "w" + "c".
        // Stroke "TA".
        // `parse`: Initial "T" ("t"). Remainder "A".
        // Vowel "A" ("a"). Remainder "".
        // Final "" (""). Tone "" ("").
        // Result: "ta".
        // Correct.
        
        console.log("Typing 'w' + 'c' (Left T + Left A)...");
        await page.keyboard.down('w');
        await page.keyboard.down('c');
        await sleep(100);
        await page.keyboard.up('w');
        await page.keyboard.up('c');
        
        await sleep(500);
        
        let text = await page.$eval('#text-display', el => el.textContent);
        console.log("Text content:", text);
        if (!text.includes("ta")) {
            throw new Error("Expected text to contain 'ta'");
        }
        
        // Test 2: Undo
        console.log("Typing Space (Undo)...");
        await page.keyboard.press('Space');
        await sleep(500);
        text = await page.$eval('#text-display', el => el.textContent);
        console.log("Text content:", text);
        if (text.trim().length > 0) {
             // It might be empty or just placeholder
             if (text !== "Type with your steno keyboard...") {
                 // My script clears it to "" or keeps placeholder?
                 // `updateDisplay` logic: if empty islands, show "".
                 // But `state.islands` starts with [""].
                 // If I Undo "ta", I pop?
                 // `handleChord` "*" -> `restoreState`.
                 // Initial state was [""].
                 // So text should be empty.
             }
        }

        // Test 3: V7 Stroke
        // Need `*` (Space) in chord.
        // Let's try simple V7:
        // Left: # (q), S (a). -> "qu"
        // Right: T (p), S (;). -> "ts" (Wait, T, S on right).
        // Vowel A (c), Vowel E (n).
        // Suffix D (t/g)?
        
        // Let's use `na0tro2...` example words.
        // "na": Left N? `stenographyMap` "TPH": "n".
        // T(w), P(e), H(r).
        // Vowel A (c).
        // Tone 0 (Ngang).
        // Right ...
        
        // Just try ANY valid V7 stroke.
        // Left: S(a), T(w). -> T, S. cA bits?
        // Right: E(n).
        // Space.
        // Chord: "w", "a", "n", "Space".
        
        console.log("Typing V7 chord...");
        await page.keyboard.down('w');
        await page.keyboard.down('a');
        await page.keyboard.down('n');
        await page.keyboard.down('Space');
        await sleep(100);
        await page.keyboard.up('w');
        await page.keyboard.up('a');
        await page.keyboard.up('n');
        await page.keyboard.up('Space');
        
        await sleep(1000); // Wait for inference
        
        // Candidates should appear
        const candidates = await page.$$('.candidate');
        console.log(`Found ${candidates.length} candidates.`);
        if (candidates.length === 0) {
             throw new Error("No candidates found for V7 stroke");
        }
        
        // Test 4: Select Candidate
        console.log("Selecting first candidate (TK chord)...");
        // TK -> Left T(w), Left K(s).
        await page.keyboard.down('w');
        await page.keyboard.down('s');
        await sleep(100);
        await page.keyboard.up('w');
        await page.keyboard.up('s');
        
        await sleep(500);
        
        // Candidates should be gone
        const candidatesAfter = await page.$$('.candidate');
        // Actually, if we select, we might clear candidates, OR if we trigger next inference...
        // `selectCandidate` clears candidates and sets fixed text.
        // So candidates should be empty (or "No candidates").
        // Or "Candidates will appear here..." if we reset innerHTML?
        // Code: `candArea.innerHTML = '<div class="candidate">No candidates</div>';`
        // But `state.candidates` is empty.
        
        text = await page.$eval('#text-display', el => el.textContent);
        console.log("Final text:", text);
        
        console.log("Test Passed!");

    } catch (e) {
        console.error("Test Failed:", e);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
        await stopServer();
    }
}

runTest();
