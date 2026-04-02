const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const session = require('express-session');
require('dotenv').config();

const GoogleSheetsDataFetcher = require('./dataFetcher');
const Database = require('./database');
const SheetCleaner = require('./sheetCleaner');
const UserDatabase = require('./userDatabase');
const setupAuth = require('./auth');

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
const REFRESH_INTERVAL = (process.env.DATA_REFRESH_INTERVAL || 5) * 60 * 1000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'rdelamaza@tur.com';

// Middleware
app.use(cors());
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'tur-dashboard-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 } // 8h
}));

// Auth setup
const userDb = new UserDatabase(process.env.DB_PATH || './sales_history.db');
const { authRouter, adminRouter, requireAuth, requireAdmin } = setupAuth(userDb, APP_URL);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);

// Setup route — solo funciona si el admin no tiene contraseña aún
app.get('/setup', async (req, res) => {
    const admin = await userDb.getUserByEmail(ADMIN_EMAIL);
    if (admin && admin.password_hash) return res.redirect('/login.html');
    const token = await userDb.ensureAdminExists(ADMIN_EMAIL);
    if (token) return res.redirect(`/set-password.html?token=${token}`);
    res.redirect('/login.html');
});

// Protect static dashboard — redirect to login if not authenticated
app.get('/', (req, res, next) => {
    if (!req.session || !req.session.userId) return res.redirect('/login.html');
    next();
});
app.get('/admin.html', (req, res, next) => {
    if (!req.session || !req.session.userId) return res.redirect('/login.html');
    if (req.session.role !== 'admin') return res.redirect('/');
    next();
});

app.use(express.static(path.join(__dirname, '../public')));

// Initialize services
const DB_PATH = process.env.DB_PATH || './sales_history.db';
const dataFetcher = new GoogleSheetsDataFetcher(SHEETS_ID);
const database = new Database(DB_PATH);
const sheetCleaner = new SheetCleaner(SHEETS_ID);

// Ensure admin user exists on startup
userDb.ensureAdminExists(ADMIN_EMAIL).then(token => {
    if (token) {
        console.log('\n========================================');
        console.log('🔐 SETUP ADMIN: Visita este link para crear tu contraseña:');
        console.log(`   ${APP_URL}/set-password.html?token=${token}`);
        console.log('========================================\n');
    }
}).catch(err => console.error('Error initializing admin:', err));

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
async function calculateAnalytics(salesData, dateStr = null) {
    const now = new Date();
    const todayStr = dateStr || getTodayDateStr(); // Chile timezone (UTC-3)

    // All sales data should already be from today only (pre-filtered by fechaChile)
    const todaySales = salesData.filter(sale => sale.fechaChile === todayStr);

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
        // Use lastProcessedDate: that's the actual date of the data in currentSalesData
        const dateToSave = lastProcessedDate;

        if (currentSalesData.length > 0 && dateToSave) {
            // Pass dateToSave so calculateAnalytics filters correctly (not by today's date)
            const finalAnalytics = await calculateAnalytics(currentSalesData, dateToSave);

            // Save to database
            await database.saveDailySummary(dateToSave, finalAnalytics);

            console.log(`📊 End of day summary saved for ${dateToSave}`);
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
app.get('/api/sales', requireAuth, async (req, res) => {
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

// Debug endpoint — shows raw sheet rows 90+ and today's filter value
app.get('/api/debug', requireAuth, requireAdmin, async (req, res) => {
    try {
        const rawData = await dataFetcher.fetchRawRows();
        const today = getTodayDateStr();
        res.json({ today, rawRows: rawData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// New endpoint for historical records
app.get('/api/records', requireAuth, async (req, res) => {
    try {
        const historicalData = await database.getHistoricalData();
        res.json(historicalData);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching historical data' });
    }
});

// Admin: backfill daily_summaries from the full Google Sheet history
app.post('/api/admin/backfill', requireAuth, requireAdmin, async (req, res) => {
    try {
        console.log('🔄 Starting backfill from Google Sheets...');
        const allSales = await dataFetcher.fetchAllData();

        // Group sales by fechaChile
        const byDate = {};
        allSales.forEach(sale => {
            if (!byDate[sale.fechaChile]) byDate[sale.fechaChile] = [];
            byDate[sale.fechaChile].push(sale);
        });

        const dates = Object.keys(byDate).sort();
        const results = [];

        for (const date of dates) {
            const salesForDate = byDate[date];
            const analytics = await calculateAnalytics(salesForDate, date);
            await database.saveDailySummary(date, analytics);
            results.push({ date, sales: analytics.today.sales, revenue: analytics.today.revenue });
            console.log(`✅ Backfilled ${date}: ${analytics.today.sales} ventas, $${analytics.today.revenue}`);
        }

        res.json({ ok: true, datesProcessed: results });
    } catch (error) {
        console.error('Backfill error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Historical: list dates that have data
app.get('/api/history/dates', requireAuth, async (req, res) => {
    try {
        const rows = await database.getAvailableDates();
        res.json(rows.map(r => r.date));
    } catch (error) {
        res.status(500).json({ error: 'Error fetching available dates' });
    }
});

// Historical: analytics for a specific date
app.get('/api/history/:date', requireAuth, async (req, res) => {
    try {
        const { date } = req.params;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Formato de fecha inválido' });
        }

        const row = await database.getDailySummary(date);
        if (!row) return res.status(404).json({ error: 'Sin datos para esta fecha' });

        const salesByHour = JSON.parse(row.sales_by_hour || '[]');
        const salesByCurrency = JSON.parse(row.currency_breakdown || '{}');

        // topProducts: full array if available (new rows), fallback to single top product
        let topProducts = [];
        if (row.top_products) {
            topProducts = JSON.parse(row.top_products);
        } else if (row.top_product) {
            topProducts = [{ product: row.top_product, count: row.top_product_sales, revenue: 0 }];
        }

        // salesByNationality: full array if available, fallback to counts from total_by_country
        let salesByNationality = [];
        if (row.sales_by_nationality) {
            salesByNationality = JSON.parse(row.sales_by_nationality);
        } else if (row.total_by_country) {
            const countryData = JSON.parse(row.total_by_country);
            salesByNationality = Object.entries(countryData)
                .sort(([, a], [, b]) => b - a)
                .map(([country, count]) => ({ country, count, revenue: 0 }));
        }

        // Enrich nationalities with coordinates for the map-style country list
        const coordinates = await database.getCountryCoordinates();
        const countryMap = coordinates.reduce((acc, c) => { acc[c.code] = c; return acc; }, {});
        const salesByCountry = salesByNationality
            .filter(n => countryMap[n.country])
            .map(n => ({ ...countryMap[n.country], sales: n.count, revenue: n.revenue }));

        res.json({
            date,
            analytics: {
                today: {
                    sales: row.total_sales,
                    revenue: row.total_revenue_usd,
                    avgSale: row.avg_sale_usd
                },
                topProducts,
                salesByHour,
                salesByCurrency,
                topOperators: [],
                salesByCountry,
                salesByNationality,
                recentSales: [],
                record: null,
                lastUpdate: row.created_at
            }
        });
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