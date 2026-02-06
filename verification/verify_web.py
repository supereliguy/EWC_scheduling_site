from playwright.sync_api import sync_playwright
import time

def verify(page):
    print("Navigating...")
    page.goto("http://localhost:8000")

    # Wait for loading to finish
    print("Waiting for app to load...")
    try:
        page.wait_for_selector("#main-app", state="visible", timeout=10000)
    except:
        print("Timeout waiting for #main-app")
        page.screenshot(path="verification/timeout.png")
        raise

    # Screenshot 1: Users
    page.screenshot(path="verification/web_users.png")
    print("Users screenshot taken")

    # Click Sites
    print("Clicking Sites...")
    page.locator(".admin-nav button").filter(has_text="Sites & Shifts").click()
    time.sleep(1)
    page.screenshot(path="verification/web_sites.png")
    print("Sites screenshot taken")

    # Click Schedule
    print("Clicking Schedule...")
    page.locator(".admin-nav button").filter(has_text="Schedule Editor").click()
    time.sleep(1)
    page.screenshot(path="verification/web_schedule.png")
    print("Schedule screenshot taken")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            verify(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
