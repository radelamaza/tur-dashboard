const https = require('https');

class SheetCleaner {
    constructor(sheetId) {
        this.sheetId = sheetId;
    }

    // Check if it's end of day (23:59)
    isEndOfDay() {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        
        // Trigger cleanup at 23:59
        return hour === 23 && minute === 59;
    }

    // Clear Google Sheet (requires Google Sheets API or manual process)
    // For now, we'll log the action and provide instructions
    async clearSheet() {
        console.log('🧹 End of day detected - Time to clear Google Sheet');
        console.log(`📊 Sheet to clear: ${this.sheetId}`);
        
        // Since we don't have Google Sheets API setup for writing,
        // we'll return instructions for manual cleanup or API setup
        
        return {
            action: 'clear_sheet',
            sheetId: this.sheetId,
            message: 'Manual cleanup required',
            instructions: [
                '1. Go to your Google Sheet',
                '2. Select all data rows (keep headers)',
                '3. Delete the selected rows',
                '4. The dashboard will automatically start fresh tomorrow'
            ]
        };
    }

    // Alternative: Clear sheet using Google Apps Script trigger
    generateGoogleAppsScript() {
        return `
// Google Apps Script to clear sheet daily
// Add this to your Google Sheet and set a daily trigger

function clearDailyData() {
  const sheet = SpreadsheetApp.openById('${this.sheetId}').getSheetByName('Sheet1');
  
  // Get all data (assuming headers are in row 1)
  const lastRow = sheet.getLastRow();
  
  if (lastRow > 1) {
    // Clear all data except headers
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    
    // Log the cleanup
    console.log('Daily data cleared on: ' + new Date());
  }
}

// Set up trigger to run daily at 23:59
function createDailyTrigger() {
  ScriptApp.newTrigger('clearDailyData')
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .create();
}
        `.trim();
    }

    // Check if new day has started
    isNewDay(lastProcessedDate) {
        const today = new Date().toISOString().split('T')[0];
        return today !== lastProcessedDate;
    }

    // Get tomorrow's date for fresh start
    getTomorrowDate() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    }
}

module.exports = SheetCleaner;