
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const SERVER_BIN = path.resolve(__dirname, '../inference-rs/target/release/inference-rs');
const MODEL_PATH = path.resolve(__dirname, '../lm.binary');
const STATIC_DIR = path.resolve(__dirname, '../static');
const PORT = 3001; // Use a different port to avoid conflicts
const BASE_URL = `http://localhost:${PORT}/infer`;

let serverProcess;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startServer() {
    console.log("Starting server for stress testing...");
    serverProcess = spawn(SERVER_BIN, [
        '--server',
        '--port', PORT.toString(),
        '--static-dir', STATIC_DIR,
        '--model-path', MODEL_PATH
    ]);

    serverProcess.stdout.on('data', (data) => {
        // console.log(`STDOUT: ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
        // console.error(`STDERR: ${data}`);
    });

    serverProcess.on('close', (code) => {
        console.log(`Server process exited with code ${code}`);
    });

    // Give it some time to start up
    await sleep(3000);
}

function stopServer() {
    if (serverProcess) {
        console.log("Stopping server...");
        serverProcess.kill();
    }
}

async function sendRequest(payload) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: '/infer',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                resolve({ status: res.statusCode, body: body });
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(data);
        req.end();
    });
}

async function runTests() {
    try {
        await startServer();

        const testCases = [
            { name: "Valid Request", payload: { islands: ["", "na0"] }, expectedStatus: 200 },
            { name: "Empty Islands", payload: { islands: [] }, expectedStatus: 200 },
            { name: "Invalid V7 Code", payload: { islands: ["", "invalidcode"] }, expectedStatus: 200 }, // Should just return empty candidates
            { name: "Incomplete V7", payload: { islands: ["", "n"] }, expectedStatus: 200 },
            { name: "Garbage Characters", payload: { islands: ["", "!@#$%^&*()"] }, expectedStatus: 200 },
            { name: "Long String", payload: { islands: ["", "na0".repeat(500)] }, expectedStatus: 200 },
        ];

        console.log("--- Sequential Tests ---");
        for (const test of testCases) {
            try {
                const res = await sendRequest(test.payload);
                if (res.status === test.expectedStatus) {
                    console.log(`[PASS] ${test.name}`);
                } else {
                    console.error(`[FAIL] ${test.name}: Expected ${test.expectedStatus}, got ${res.status}`);
                }
            } catch (e) {
                console.error(`[FAIL] ${test.name}: Request failed - ${e.message}`);
            }
        }

        console.log("\n--- Concurrent Stress Test ---");
        const concurrency = 100;
        const promises = [];
        console.log(`Sending ${concurrency} mixed requests simultaneously...`);
        
        for (let i = 0; i < concurrency; i++) {
            const test = testCases[i % testCases.length];
            promises.push(sendRequest(test.payload).then(res => {
                if (res.status !== 200) throw new Error(`Status ${res.status}`);
            }));
        }

        try {
            await Promise.all(promises);
            console.log(`[PASS] All ${concurrency} concurrent requests handled.`);
        } catch (e) {
            console.error(`[FAIL] Concurrent test failed: ${e.message}`);
        }

        // Verify server is still alive with a valid request
        console.log("\n--- Liveness Check ---");
        const liveRes = await sendRequest({ islands: ["", "na0"] });
        if (liveRes.status === 200) {
            console.log("[PASS] Server is still alive.");
        } else {
            console.error("[FAIL] Server died or is unresponsive.");
            process.exit(1);
        }

    } catch (e) {
        console.error("Global Error:", e);
        process.exit(1);
    } finally {
        stopServer();
    }
}

runTests();
