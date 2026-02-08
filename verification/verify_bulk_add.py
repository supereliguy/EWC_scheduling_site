from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto("http://localhost:8080/index.html")

        # Wait for app to load (loading overlay gone)
        page.wait_for_selector("#loading", state="hidden")

        # 1. Bulk Add Users
        # Ensure Users section is visible (it is default, but click tab to be safe)
        # Tab button text is "Users"
        page.click(".list-group-item:has-text('Users')")
        time.sleep(0.5)

        # Click Bulk Add button in Users section
        page.locator("#users-section button:has-text('Bulk Add')").click()

        # Wait for modal
        page.wait_for_selector("#bulkAddModal", state="visible")
        time.sleep(0.5)

        # Type in textarea
        page.fill("#bulk-input-text", "user_alpha\nuser_beta|admin\nuser_gamma")

        # Click Process
        page.click("#bulkAddModal button:has-text('Process')")

        # Wait for results
        page.wait_for_selector("#bulk-results:not(.d-none)")
        time.sleep(1) # Animation/Render

        # Screenshot Modal Result
        page.screenshot(path="verification/bulk_users_result.png")

        # Close Modal
        page.click("#bulkAddModal .btn-close")
        time.sleep(1.0) # wait for fade out

        # 2. Verify Users Table
        # Check if users are added
        # Just screenshot the table area
        table = page.locator("#users-table")
        table.screenshot(path="verification/users_table.png")

        # 3. Bulk Add Sites
        # Switch to Sites
        page.click(".list-group-item:has-text('Sites & Shifts')")
        time.sleep(0.5)

        # Click Bulk Add
        page.locator("#sites-section button:has-text('Bulk Add')").click()

        # Wait for modal
        page.wait_for_selector("#bulkAddModal", state="visible")
        time.sleep(0.5)

        # Type sites
        page.fill("#bulk-input-text", "Site Alpha\nSite Beta")

        # Click Process
        page.click("#bulkAddModal button:has-text('Process')")

        # Wait for results
        page.wait_for_selector("#bulk-results:not(.d-none)")
        time.sleep(1)

        # Screenshot Sites Result
        page.screenshot(path="verification/bulk_sites_result.png")

        # Close Modal
        page.click("#bulkAddModal .btn-close")
        time.sleep(1.0)

        # Verify Sites Table
        table = page.locator("#sites-table")
        table.screenshot(path="verification/sites_table.png")

        browser.close()

if __name__ == "__main__":
    run()
