from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:8000/index.html")

        # Wait for loading to finish
        try:
            page.wait_for_selector("#loading", state="hidden", timeout=5000)
        except:
            print("Loading screen didn't disappear")
            page.screenshot(path="loading_fail.png")
            browser.close()
            return

        # Seed Data
        page.evaluate("""async () => {
            // Create User
            await window.api.request('POST', '/api/users', { username: 'TestUser', role: 'admin' });
            // Create Site
            const res = await window.api.request('POST', '/api/sites', { name: 'TestSite' });
            const siteId = res.id;
            // Create Shift
            await window.api.request('POST', `/api/sites/${siteId}/shifts`, { name: 'Day', start_time: '08:00', end_time: '16:00' });

            // Reload sites list in UI (adminSites variable needs refresh)
            await window.loadSites();
            await window.loadUsers();

            // Enter Site Dashboard
            await window.enterSite(siteId);
        }""")

        # Wait for dashboard to appear
        try:
            page.wait_for_selector("#site-dashboard-section", state="visible", timeout=5000)
        except:
             print("Dashboard not visible")
             page.screenshot(path="dashboard_fail.png")
             browser.close()
             return

        # Click Export Dropdown
        # Use exact match to avoid "Export Backup"
        export_btn = page.get_by_role("button", name="Export", exact=True)

        if export_btn.count() > 0:
            print("Export button found")
            export_btn.click()
            # Wait for menu
            try:
                page.wait_for_selector(".dropdown-menu.show", timeout=2000)
            except:
                print("Menu didn't open")
        else:
            print("Export button NOT found")

        # Scroll to bottom to see footer
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")

        # Take Screenshot
        page.screenshot(path="verification.png")

        browser.close()

if __name__ == "__main__":
    run()
