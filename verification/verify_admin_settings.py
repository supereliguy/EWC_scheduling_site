from playwright.sync_api import sync_playwright

def verify_settings(page):
    # 1. Login
    page.goto('http://localhost:3000/login.html')
    page.fill('#username', 'admin')
    page.fill('#password', 'admin123')
    page.click('button:text("Login")')

    page.wait_for_timeout(2000)

    # Navigate to Admin
    page.goto('http://localhost:3000/admin.html')

    # 2. Open Settings
    # Need to find a user row.
    page.wait_for_selector('#users-table tbody tr', timeout=5000)

    # Click "Settings" on first user
    page.click('button:text("Settings")')

    # 3. Check Modal
    page.wait_for_selector('#settings-modal', state='visible', timeout=5000)

    # 4. Screenshot
    page.screenshot(path='verification/admin_settings_modal.png')
    print("Screenshot taken")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_settings(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path='verification/error.png')
        finally:
            browser.close()
