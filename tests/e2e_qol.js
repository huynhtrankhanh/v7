
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');

// Start server
const server = spawn('python3', ['-m', 'http.server', '8000'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore'
});

async function runTests() {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        // Mock /infer endpoint
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (request.url().endsWith('/infer')) {
                request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ candidates: [] })
                });
            } else {
                request.continue();
            }
        });

        await page.goto('http://localhost:8000/static/index.html');

        // Wait for page to load
        await page.waitForSelector('#text-display');

        console.log("Test 1: Stroke S-P appends space");
        // Simulate stroke input. We can't easily simulate physical keys for steno unless we know the mapping perfectly.
        // We can expose handleChord in script.js OR we can just inject JS execution.
        // We modified script.js, but handleChord is global function.
        await page.evaluate(() => {
            window.handleChord("SP");
        });
        let content = await page.evaluate(() => document.getElementById("text-display").innerText);
        if (!content.includes(" ")) throw new Error("Space not appended");
        console.log("PASS: Space appended");

        console.log("Test 2: Shift + Letter");
        await page.keyboard.down('Shift');
        await page.keyboard.press('A');
        await page.keyboard.up('Shift');
        content = await page.evaluate(() => document.getElementById("text-display").innerText);
        if (!content.includes("A")) throw new Error("Shift+A not appended");
        console.log("PASS: Shift+Letter appended");

        console.log("Test 3: Enter for Newline");
        await page.keyboard.press('Enter');
        content = await page.evaluate(() => document.getElementById("text-display").innerText);
        // Note: innerText might show newline as line break.
        // We can check textContent or use regex.
        if (!/\n/.test(content) && !content.includes("\n")) throw new Error("Newline not appended");
        console.log("PASS: Enter appended newline");

        console.log("Test 4: Escape Hatch #S");
        await page.evaluate(() => {
            window.handleChord("#S");
        });
        // Check for textarea
        const hasTextarea = await page.evaluate(() => !!document.querySelector("textarea"));
        if (!hasTextarea) throw new Error("Textarea not found");
        console.log("PASS: Escape hatch entered textarea mode");

        console.log("Test 5: Escape to exit");
        await page.keyboard.press('Escape');
        const hasTextareaAfter = await page.evaluate(() => !!document.querySelector("textarea"));
        if (hasTextareaAfter) throw new Error("Textarea still present");
        console.log("PASS: Escape exited textarea mode");

        console.log("Test 6: Punctuation");
        await page.evaluate(() => {
            window.handleChord("TPPL");
        });
        content = await page.evaluate(() => document.getElementById("text-display").innerText);
        if (!content.includes(".")) throw new Error("Punctuation not appended");
        console.log("PASS: Punctuation appended");

        console.log("All tests passed");

    } catch (e) {
        console.error("Test failed", e);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
}

// Give server time to start
setTimeout(runTests, 2000);
