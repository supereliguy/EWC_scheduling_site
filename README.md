# Schedule Request Webpage Setup

Follow these instructions to set up the Google Sheet and deploy the Google Apps Script to collect schedule request data.

## 1. Create a Google Sheet

1.  **Create a new Google Sheet:** Go to [sheets.new](https://sheets.new).
2.  **Name your sheet:** For example, "Schedule Requests".
3.  **Set up the header row:** In the first row, enter the following headers:
    *   `A1`: `User`
    *   `B1`: `Year`
    *   `C1`: `Month`
    *   `D1`: `1`
    *   `E1`: `2`
    *   ...and so on, up to `AH1` for `31`.
4.  **Get the Sheet ID:** The URL of your sheet will look like this: `https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit`. Copy the `YOUR_SHEET_ID` part.

## 2. Create and Deploy the Google Apps Script

1.  **Open the Apps Script editor:** In your Google Sheet, go to `Extensions` > `Apps Script`.
2.  **Name your script:** Give it a name like "Schedule Collector".
3.  **Paste the script code:** Copy the contents of the `Code.gs` file and paste it into the script editor, replacing any existing code.
4.  **Update the Sheet ID:** In the script, replace `'YOUR_SHEET_ID'` with the actual ID of your Google Sheet that you copied in step 1.
5.  **Deploy the script:**
    *   Click the **Deploy** button and select **New deployment**.
    *   Click the gear icon next to "Select type" and choose **Web app**.
    *   In the "Description" field, you can add a description like "Schedule Request Collector".
    *   Under "Who has access," select **Anyone**.
    *   Click **Deploy**.
6.  **Authorize the script:** Google will ask you to authorize the script. Follow the prompts to grant it permission to access your Google Sheets.
7.  **Copy the Web app URL:** After deploying, you will be given a **Web app URL**. Copy this URL.

## 3. Configure the Webpage

1.  **Update the JavaScript file:** Open the `script.js` file.
2.  **Set the Google Apps Script URL:** Find the line `const googleAppsScriptUrl = 'YOUR_GOOGLE_APPS_SCRIPT_URL';` and replace `'YOUR_GOOGLE_APPS_SCRIPT_URL'` with the Web app URL you copied in the previous step.
3.  **Save the file.**

## 4. Host the Webpage

You can now host the `index.html`, `style.css`, and `script.js` files on any web hosting service, such as GitHub Pages, Netlify, or Vercel, to make the schedule request form accessible to your users.
