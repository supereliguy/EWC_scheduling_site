from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:3000")

        # Wait for loading
        try:
            page.wait_for_selector("#loading", state="hidden", timeout=10000)
        except:
            print("Loading screen didn't disappear or wasn't found")

        # Navigate to Sites section
        page.click("text=Sites & Shifts")

        # Wait for sites section to be visible
        page.wait_for_selector("#sites-section", state="visible")

        # Create a site to access dashboard if not present
        # Check if table has rows?
        # Just create one to be safe, assuming name is unique or duplicate is handled
        page.fill("#new-site-name", "Test Site")
        page.click("#create-site-btn")

        # Wait for it to appear
        page.wait_for_selector("text=Test Site")

        # Enter dashboard
        # Find the row with "Test Site" and click "Enter Dashboard"
        # Since we just added it, it should be there.
        # We can click the first "Enter Dashboard" button we find if we are lazy, or be specific.
        page.click("button:has-text('Enter Dashboard')")

        # Wait for dashboard to load
        page.wait_for_selector("#sd-site-name")

        # Click "Roles" tab (renamed from Categories)
        page.click("a.nav-link:has-text('Roles')")

        # Wait for tab content
        page.wait_for_selector("#sd-categories", state="visible")

        # Click "Add Role"
        page.click("button:has-text('Add Role')")

        # Wait for modal
        page.wait_for_selector("#categoryModal", state="visible")
        time.sleep(1) # Wait for fade in

        # Check for "Fill First / Core Staff" label
        fill_first = page.is_visible("text=Fill First / Core Staff")
        print(f"Fill First checkbox visible: {fill_first}")

        if not fill_first:
            print("ERROR: Fill First checkbox not found!")

        # Take screenshot of the modal
        page.screenshot(path="verify_roles.png")

        browser.close()

if __name__ == "__main__":
    run()
