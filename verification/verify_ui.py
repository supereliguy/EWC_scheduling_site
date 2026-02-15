from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    try:
        page.goto("http://localhost:8080/index.html")

        # Wait for loading to finish (overlay hidden)
        try:
            page.wait_for_selector("#loading", state="hidden", timeout=10000)
        except:
            print("Loading timeout - checking console")

        # Click Global Settings in sidebar
        page.click("text=Global Settings")

        # Wait for section visibility
        page.wait_for_selector("#global-settings-section", state="visible")

        # Verify Inputs
        # Check Min Rest Hours
        min_rest = page.locator("#gs-min-rest-hours")
        if min_rest.is_visible():
            print("Found Min Rest Hours input")
            val = min_rest.input_value()
            print(f"Value: {val}")
            if val == "10":
                print("Default value verified.")
            else:
                print(f"Unexpected value: {val}")
        else:
            print("FAIL: Min Rest Hours input not found")

        # Check Weight
        weight = page.locator("#rw-min-rest-hours")
        if weight.is_visible():
            print("Found Min Rest Hours Weight input")
            val = weight.input_value()
            print(f"Value: {val}")
        else:
            print("FAIL: Weight input not found")

        page.screenshot(path="verification/ui_check.png")
    except Exception as e:
        print(f"Error: {e}")
        page.screenshot(path="verification/error.png")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
