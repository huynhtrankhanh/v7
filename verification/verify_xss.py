from playwright.sync_api import sync_playwright, Page, expect

def test_xss_rendering(page: Page):
    # Intercept script.js to expose state and updateDisplay
    def handle_script(route):
        response = route.fetch()
        body = response.text()
        body += "\nwindow.state = state;\nwindow.updateDisplay = updateDisplay;"
        route.fulfill(response=response, body=body)

    page.route("**/script.js", handle_script)

    # Navigate to the static page
    page.goto("http://localhost:8000/index.html")

    # Inject state with XSS payload
    page.evaluate("""
        window.state.candidates = [
            ["<img src=x onerror=alert('XSS')>"],
            ["Safe Candidate"]
        ];
        window.updateDisplay();
    """)

    # Verify that the XSS payload is rendered as text
    # We expect the text content to contain the tag string
    candidate_text = page.locator(".candidate").first.locator(".candidate-text")
    expect(candidate_text).to_contain_text("<img src=x onerror=alert('XSS')>")

    # Check that no image tag exists in the DOM inside candidate-text
    # (The locator matching 'img' inside .candidate-text should be 0)
    count = page.locator(".candidate-text img").count()
    if count > 0:
        raise Exception("Found <img> tag rendered in candidate text! XSS possible.")

    print("XSS payload rendered safely as text.")

    # Screenshot
    page.screenshot(path="/home/jules/verification/verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_xss_rendering(page)
        finally:
            browser.close()
