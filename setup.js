const SheetCleaner = require('./src/sheetCleaner');

const SHEETS_ID = '1q1WjPguhUlfct_duJA3gOOrSWuF-g67YlTieay8NtPs';

console.log('🚀 Setting up Tour Dashboard...\n');

console.log('📋 Google Apps Script for automatic sheet cleanup:');
console.log('1. Go to your Google Sheet');
console.log('2. Click Extensions → Apps Script');
console.log('3. Copy and paste this code:');
console.log('=' * 50);

const cleaner = new SheetCleaner(SHEETS_ID);
const script = cleaner.generateGoogleAppsScript();

console.log(script);

console.log('=' * 50);
console.log('\n4. Save the script and run "createDailyTrigger()" once to set up automatic cleanup');
console.log('\n📊 Your dashboard will now:');
console.log('   - Show only today\'s sales');
console.log('   - Save daily summaries to local database');
console.log('   - Track records and milestones');
console.log('   - Display Latin America sales map');
console.log('   - Reset automatically each day');

console.log('\n🎯 To start the dashboard run: npm run dev');
console.log('\n🌐 Dashboard will be available at: http://localhost:3000');