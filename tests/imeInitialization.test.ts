import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("IME HTML starts in its final empty layout before the bundle loads", () => {
  const html = readFileSync(resolve("static/ime.html"), "utf8");

  expect(html).toContain('class="text-display-flow empty-text-display-flow"');
  expect(html).toContain('<span class="empty-wave">👋</span>');
  expect(html).toContain('id="candidate-area"');
  expect(html).toContain('style="display: none"');
  expect(html).not.toContain("Candidates will appear here...");
  expect(html).not.toContain("Start typing with your steno keyboard...");
});

test("IME applies native compact-mode classes before parsing its layout", () => {
  const html = readFileSync(resolve("static/ime.html"), "utf8");
  const bootstrap = html.indexOf("const bridge = window.AndroidIme");
  const layout = html.indexOf('<main id="inference-shell">');

  expect(bootstrap).toBeGreaterThan(0);
  expect(bootstrap).toBeLessThan(layout);
  expect(html).toContain('"android-raw-outline"');
  expect(html).toContain('"android-normal-typing"');
});
