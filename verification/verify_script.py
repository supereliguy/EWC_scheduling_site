from playwright.sync_api import sync_playwright

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. Login Page
        print("Navigating to login page...")
        page.goto("http://localhost:3000/login.html")
        page.screenshot(path="verification/1_login_page.png")
        print("Login page screenshot saved.")

        # 2. Login as Admin
        print("Logging in as admin...")
        page.fill("#username", "admin")
        page.fill("#password", "password123")
        page.click("button")

        # Wait for redirect (Admin redirects to /admin.html)
        page.wait_for_url("http://localhost:3000/admin.html")
        page.wait_for_selector("h1")

        # 3. Admin Dashboard
        print("Verifying Admin Dashboard...")
        page.screenshot(path="verification/3_admin_dashboard.png")
        print("Admin Dashboard screenshot saved.")

        # 4. Navigate to User Dashboard
        print("Navigating to User Dashboard...")
        page.goto("http://localhost:3000/index.html")
        page.wait_for_selector("#welcome-msg")
        page.screenshot(path="verification/2_user_dashboard.png")
        print("User Dashboard screenshot saved.")

        browser.close()

if __name__ == "__main__":
    verify_frontend()
