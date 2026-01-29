from playwright.sync_api import sync_playwright
import time

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # 1. Login Page
        print("Navigating to login...")
        page.goto("http://localhost:3000/login.html")
        page.screenshot(path="verification/login_page.png")
        print("Captured login_page.png")

        # 2. Login as Admin
        page.fill("#username", "admin")
        page.fill("#password", "password123")
        page.click("button[type=submit]")

        # Wait for navigation
        page.wait_for_url("**/admin.html")
        page.wait_for_selector("h1:has-text('Admin Dashboard')")

        # Click through sections
        page.click("button:has-text('Sites & Shifts')")
        time.sleep(0.5)
        page.screenshot(path="verification/admin_sites.png")
        print("Captured admin_sites.png")

        page.click("button:has-text('Schedule')")
        time.sleep(0.5)
        page.screenshot(path="verification/admin_schedule.png")
        print("Captured admin_schedule.png")

        # Logout
        page.click("#logout-btn")
        page.wait_for_url("**/login.html")

        # 3. Login as User
        page.fill("#username", "testuser")
        page.fill("#password", "password123")
        page.click("button[type=submit]")

        # Wait for navigation
        page.wait_for_url("**/index.html")
        page.wait_for_selector("#welcome-msg")
        time.sleep(1) # Wait for calendar render

        page.screenshot(path="verification/user_dashboard.png")
        print("Captured user_dashboard.png")

        browser.close()

if __name__ == "__main__":
    verify_frontend()
