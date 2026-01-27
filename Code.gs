function doPost(e) {
  try {
    // Check if the request has postData and contents
    if (!e.postData || !e.postData.contents) {
      throw new Error("Invalid POST data.");
    }

    var data = JSON.parse(e.postData.contents);
    var user = data.user;
    var year = data.year;
    var month = data.month;
    var schedule = data.schedule;

    // Replace 'YOUR_SHEET_ID' with your Google Sheet ID
    var sheet = SpreadsheetApp.openById('YOUR_SHEET_ID').getActiveSheet();

    // Prepare the row data
    var rowData = [user, year, month];
    var lastDay = new Date(year, month, 0).getDate();

    for (var i = 1; i <= 31; i++) {
      if (i <= lastDay) {
        rowData.push(schedule[i] || 'unselected');
      } else {
        rowData.push(''); // Push empty for days beyond the current month
      }
    }

    sheet.appendRow(rowData);

    return ContentService.createTextOutput(JSON.stringify({ "status": "success" })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    // Log the error for debugging
    console.error(error.toString());
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
