const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const GoogleSheetsDataFetcher = require('./dataFetcher');
const Database = require('./database');
const SheetCleaner = require('./sheetCleaner');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const SHEETS_ID = process.env.GOOGLE_SHEETS_ID || '1q1WjPguhUlfct_duJA3gOOrSWuF-g67YlTieay8NtPs';
const REFRESH_INTERVAL = (process.env.DATA_REFRESH_INTERVAL || 5) * 60 * 1000; // Convert to milliseconds

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize services
const dataFetcher = new GoogleSheetsDataFetcher(SHEETS_ID);
const database = new Database();
const sheetCleaner = new SheetCleaner(SHEETS_ID);

// Store current sales data (only today's data)
let currentSalesData = [];
let lastUpdateTime = null;
let lastProcessedDate = null;
let cachedRecord = null; // Cache del récord de kpis diarios

// Get today's date in Chilean timezone
function getTodayDateStr() {
    const now = new Date();
    // Convert to Chilean timezone (UTC-3 standard, UTC-4 in summer)
    const chileTime = new Date(now.getTime() - (3 * 60 * 60 * 1000)); // UTC-3
    return chileTime.toISOString().split('T')[0];
}

// Analytics calculations (only today's data)
async function calculateAnalytics(salesData) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStr = now.toISOString().split('T')[0];

    // All sales data should already be from today only
    const todaySales = salesData.filter(sale => {
        const saleDate = new Date(sale.date);
        return saleDate >= today;
    });

    // Get historical data from database
    const salesByCountry = await database.getSalesByCountry(todaySales);

    // Calculate totals in CLP (only today) - no conversion needed
    const todayTotal = todaySales.reduce((sum, sale) => {
        return sum + sale.amount; // Already in CLP from monto_clp
    }, 0);

    // Sales count (only today)
    const todayCount = todaySales.length;

    // Average sale value (only today)
    const avgSaleToday = todayCount > 0 ? todayTotal / todayCount : 0;

    // Top products today (with revenue)
    const productStats = {};
    todaySales.forEach(sale => {
        if (!productStats[sale.product]) {
            productStats[sale.product] = { count: 0, revenue: 0 };
        }
        productStats[sale.product].count++;
        productStats[sale.product].revenue += sale.amount;
    });

    const topProducts = Object.entries(productStats)
        .sort(([,a], [,b]) => b.count - a.count)
        .slice(0, 10)
        .map(([product, stats]) => ({ product, count: stats.count, revenue: Math.round(stats.revenue) }));

    // Sales by hour (today) — sale.date is UTC, subtract 3h to get Chile hour
    const salesByHour = Array(24).fill(0);
    todaySales.forEach(sale => {
        const chileHour = (new Date(sale.date).getUTCHours() - 3 + 24) % 24;
        salesByHour[chileHour]++;
    });

    // Sales by currency
    const salesByCurrency = {};
    todaySales.forEach(sale => {
        salesByCurrency[sale.currency] = (salesByCurrency[sale.currency] || 0) + sale.amount;
    });

    // Sales by nationality/country
    const nationalityStats = {};
    todaySales.forEach(sale => {
        const nat = sale.nationality || 'XX';
        if (!nationalityStats[nat]) {
            nationalityStats[nat] = { count: 0, revenue: 0 };
        }
        nationalityStats[nat].count++;
        nationalityStats[nat].revenue += sale.amount;
    });

    const salesByNationality = Object.entries(nationalityStats)
        .sort(([,a], [,b]) => b.count - a.count)
        .map(([country, stats]) => ({ country, count: stats.count, revenue: Math.round(stats.revenue) }));

    // Top operators (revenue in CLP)
    const operatorRevenue = {};
    todaySales.forEach(sale => {
        operatorRevenue[sale.operator] = (operatorRevenue[sale.operator] || 0) + sale.amount;
    });

    const topOperators = Object.entries(operatorRevenue)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([operator, revenue]) => ({ operator, revenue: Math.round(revenue) }));

    return {
        today: {
            sales: todayCount,
            revenue: Math.round(todayTotal),
            avgSale: Math.round(avgSaleToday)
        },
        topProducts,
        salesByHour,
        salesByCurrency,
        topOperators,
        salesByCountry,
        salesByNationality,
        recentSales: salesData.slice(-10).reverse(),
        record: cachedRecord,
        lastUpdate: lastUpdateTime
    };
}

// Fetch and update data
async function updateSalesData() {
    try {
        const today = getTodayDateStr(); // Use Chilean timezone
        
        // Check if it's a new day
        if (lastProcessedDate && lastProcessedDate !== today) {
            await handleEndOfDay();
        }
        
        console.log('Fetching sales data...');
        const [newData, kpisRecord] = await Promise.all([
            dataFetcher.fetchData(),
            dataFetcher.fetchKpisDiarios()
        ]);
        if (kpisRecord) cachedRecord = kpisRecord;
        
        // Filter only today's data using fechaChile (already correct Chile date from col N)
        const todayData = newData.filter(sale => sale.fechaChile === today);
        
        // Check if there are new sales
        const newSalesCount = todayData.length;
        const previousCount = currentSalesData.length;
        
        currentSalesData = todayData;
        lastUpdateTime = new Date().toISOString();
        lastProcessedDate = today;
        
        const analytics = await calculateAnalytics(currentSalesData);
        
        // Emit to all connected clients
        io.emit('salesUpdate', {
            sales: currentSalesData,
            analytics,
            newSalesCount: Math.max(0, newSalesCount - previousCount)
        });
        
        console.log(`Updated: ${todayData.length} today's sales, ${Math.max(0, newSalesCount - previousCount)} new sales`);
        
        // Export to CSV for Evidence dashboard
        exportToCSV(currentSalesData);
        
        // Check for end of day
        if (sheetCleaner.isEndOfDay()) {
            await handleEndOfDay();
        }
        
    } catch (error) {
        console.error('Error updating sales data:', error);
    }
}

// Exportar ventas a CSV para Evidence
function exportToCSV(sales) {
    try {
        const headers = 'id,product,date,amount,currency,operator,client,nationality\n';
        const rows = sales.map(s => [
            s.id,
            `"${(s.product || '').replace(/"/g, '""')}"`,
            s.date,
            s.amount,
            s.currency,
            `"${(s.operator || '').replace(/"/g, '""')}"`,
            `"${(s.client || '').replace(/"/g, '""')}"`,
            s.nationality
        ].join(',')).join('\n');
        
        const csvPath = path.join(__dirname, '../public/sales.csv');
        fs.writeFileSync(csvPath, headers + rows, 'utf8');
        console.log(`📄 CSV exportado: ${sales.length} ventas → public/sales.csv`);
    } catch (error) {
        console.error('Error exportando CSV:', error);
    }
}

// Handle end of day processing
async function handleEndOfDay() {
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        if (currentSalesData.length > 0) {
            // Calculate final analytics for the day
            const finalAnalytics = await calculateAnalytics(currentSalesData);
            
            // Save to database
            await database.saveDailySummary(yesterdayStr, finalAnalytics);
            
            console.log(`📊 End of day summary saved for ${yesterdayStr}`);
        }
        
        // Clear current data for fresh start
        currentSalesData = [];
        
        // Generate sheet cleanup instructions
        const cleanupInstructions = await sheetCleaner.clearSheet();
        console.log('🧹 Sheet cleanup instructions:', cleanupInstructions);
        
        // Notify clients about new day
        io.emit('newDay', {
            message: 'New day started! Dashboard reset.',
            cleanupInstructions
        });
        
    } catch (error) {
        console.error('Error handling end of day:', error);
    }
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/api/sales', async (req, res) => {
    try {
        if (currentSalesData.length === 0) {
            await updateSalesData();
        }
        
        const analytics = await calculateAnalytics(currentSalesData);
        
        res.json({
            sales: currentSalesData,
            analytics,
            lastUpdate: lastUpdateTime
        });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching sales data' });
    }
});

// New endpoint for historical records
app.get('/api/records', async (req, res) => {
    try {
        const historicalData = await database.getHistoricalData();
        res.json(historicalData);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching historical data' });
    }
});

// New endpoint for Google Apps Script
app.get('/api/cleanup-script', (req, res) => {
    const script = sheetCleaner.generateGoogleAppsScript();
    res.type('text/javascript');
    res.send(script);
});

// Socket.IO connections
io.on('connection', (socket) => {
    console.log('Client connected');
    
    // Send current data to newly connected client
    if (currentSalesData.length > 0) {
        const analytics = calculateAnalytics(currentSalesData);
        socket.emit('salesUpdate', {
            sales: currentSalesData,
            analytics,
            newSalesCount: 0
        });
    }
    
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Initialize data and start periodic updates
updateSalesData();
setInterval(updateSalesData, REFRESH_INTERVAL);

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Tour Dashboard running on http://localhost:${PORT}`);
    console.log(`📊 Data refresh interval: ${REFRESH_INTERVAL / 60000} minutes`);
});