const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor(dbPath = './sales_history.db') {
        const resolvedPath = path.resolve(dbPath);
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        this.dbPath = resolvedPath;
        this.db = null;
        this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err);
                    reject(err);
                } else {
                    console.log('📊 Database connected successfully');
                    this.createTables().then(resolve).catch(reject);
                }
            });
        });
    }

    async createTables() {
        const createTablesSQL = [
            // Daily summaries table
            `CREATE TABLE IF NOT EXISTS daily_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT UNIQUE NOT NULL,
                total_sales INTEGER NOT NULL,
                total_revenue_usd REAL NOT NULL,
                avg_sale_usd REAL NOT NULL,
                top_product TEXT,
                top_product_sales INTEGER,
                total_by_country TEXT, -- JSON string
                sales_by_hour TEXT, -- JSON string
                currency_breakdown TEXT, -- JSON string
                top_products TEXT, -- JSON string (full array)
                sales_by_nationality TEXT, -- JSON string (full array)
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Records table for tracking milestones
            `CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_type TEXT NOT NULL, -- 'daily_sales', 'daily_revenue', 'single_sale'
                record_value REAL NOT NULL,
                record_date TEXT NOT NULL,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Countries mapping for Latin America
            `CREATE TABLE IF NOT EXISTS countries_mapping (
                code TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                region TEXT NOT NULL
            )`
        ];

        for (const sql of createTablesSQL) {
            await this.run(sql);
        }

        // Migrate: add columns for existing DBs that predate this schema
        const migrations = [
            'ALTER TABLE daily_summaries ADD COLUMN top_products TEXT',
            'ALTER TABLE daily_summaries ADD COLUMN sales_by_nationality TEXT',
            'ALTER TABLE daily_summaries ADD COLUMN top_operators TEXT'
        ];
        for (const sql of migrations) {
            try { await this.run(sql, [], { silent: true }); } catch (e) { /* column already exists */ }
        }

        // Insert Latin America countries data
        await this.insertCountriesData();
    }

    async insertCountriesData() {
        const countries = [
            { code: 'AR', name: 'Argentina', lat: -38.4161, lng: -63.6167, region: 'South America' },
            { code: 'BO', name: 'Bolivia', lat: -16.2902, lng: -63.5887, region: 'South America' },
            { code: 'BR', name: 'Brasil', lat: -14.2350, lng: -51.9253, region: 'South America' },
            { code: 'CL', name: 'Chile', lat: -35.6751, lng: -71.5430, region: 'South America' },
            { code: 'CO', name: 'Colombia', lat: 4.5709, lng: -74.2973, region: 'South America' },
            { code: 'EC', name: 'Ecuador', lat: -1.8312, lng: -78.1834, region: 'South America' },
            { code: 'GY', name: 'Guyana', lat: 4.8604, lng: -58.9302, region: 'South America' },
            { code: 'PE', name: 'Perú', lat: -9.1900, lng: -75.0152, region: 'South America' },
            { code: 'PY', name: 'Paraguay', lat: -23.4425, lng: -58.4438, region: 'South America' },
            { code: 'SR', name: 'Suriname', lat: 3.9193, lng: -56.0278, region: 'South America' },
            { code: 'UY', name: 'Uruguay', lat: -32.5228, lng: -55.7658, region: 'South America' },
            { code: 'VE', name: 'Venezuela', lat: 6.4238, lng: -66.5897, region: 'South America' },
            { code: 'MX', name: 'México', lat: 23.6345, lng: -102.5528, region: 'North America' },
            { code: 'GT', name: 'Guatemala', lat: 15.7835, lng: -90.2308, region: 'Central America' },
            { code: 'CR', name: 'Costa Rica', lat: 9.7489, lng: -83.7534, region: 'Central America' },
            { code: 'PA', name: 'Panamá', lat: 8.5380, lng: -80.7821, region: 'Central America' },
            { code: 'ES', name: 'España', lat: 40.4637, lng: -3.7492, region: 'Europe' },
            { code: 'DE', name: 'Alemania', lat: 51.1657, lng: 10.4515, region: 'Europe' }
        ];

        for (const country of countries) {
            await this.run(
                'INSERT OR IGNORE INTO countries_mapping (code, name, lat, lng, region) VALUES (?, ?, ?, ?, ?)',
                [country.code, country.name, country.lat, country.lng, country.region]
            );
        }
    }

    async run(sql, params = [], { silent = false } = {}) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    if (!silent) console.error('Database error:', err);
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    console.error('Database error:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('Database error:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Save daily summary
    async saveDailySummary(date, analytics) {
        const { today } = analytics;

        // Get top product
        const topProduct = analytics.topProducts[0] || { product: null, count: 0 };

        // Prepare country data (legacy column — kept for backwards compat)
        const countryData = {};
        analytics.recentSales.forEach(sale => {
            if (sale.nationality) {
                countryData[sale.nationality] = (countryData[sale.nationality] || 0) + 1;
            }
        });

        try {
            await this.run(`
                INSERT OR REPLACE INTO daily_summaries
                (date, total_sales, total_revenue_usd, avg_sale_usd, top_product, top_product_sales,
                 total_by_country, sales_by_hour, currency_breakdown, top_products, sales_by_nationality, top_operators)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                date,
                today.sales,
                today.revenue,
                today.avgSale,
                topProduct.product,
                topProduct.count,
                JSON.stringify(countryData),
                JSON.stringify(analytics.salesByHour),
                JSON.stringify(analytics.salesByCurrency),
                JSON.stringify(analytics.topProducts),
                JSON.stringify(analytics.salesByNationality),
                JSON.stringify(analytics.topOperators)
            ]);

            // Check and update records
            await this.checkAndUpdateRecords(date, today);

            console.log(`📊 Daily summary saved for ${date}`);
        } catch (error) {
            console.error('Error saving daily summary:', error);
        }
    }

    // Check if any records were broken
    async checkAndUpdateRecords(date, todayData) {
        const records = [
            { type: 'daily_sales', value: todayData.sales, description: 'Most sales in one day' },
            { type: 'daily_revenue', value: todayData.revenue, description: 'Highest revenue in one day' }
        ];

        for (const record of records) {
            const currentRecord = await this.get(
                'SELECT * FROM records WHERE record_type = ? ORDER BY record_value DESC LIMIT 1',
                [record.type]
            );

            if (!currentRecord || record.value > currentRecord.record_value) {
                await this.run(
                    'INSERT INTO records (record_type, record_value, record_date, description) VALUES (?, ?, ?, ?)',
                    [record.type, record.value, date, record.description]
                );
                console.log(`🏆 New record! ${record.description}: ${record.value}`);
            }
        }
    }

    // Get historical data for dashboard
    async getHistoricalData() {
        const records = await this.all('SELECT * FROM records ORDER BY record_value DESC');
        const recentSummaries = await this.all(
            'SELECT * FROM daily_summaries ORDER BY date DESC LIMIT 30'
        );
        
        return {
            records: records.reduce((acc, record) => {
                acc[record.record_type] = record;
                return acc;
            }, {}),
            recentSummaries
        };
    }

    // Get country coordinates for map
    async getCountryCoordinates() {
        return await this.all('SELECT * FROM countries_mapping');
    }

    // Get sales by country for today
    async getSalesByCountry(salesData) {
        const countryStats = {};
        const coordinates = await this.getCountryCoordinates();
        const countryMap = coordinates.reduce((acc, country) => {
            acc[country.code] = country;
            return acc;
        }, {});

        salesData.forEach(sale => {
            if (sale.nationality && countryMap[sale.nationality]) {
                if (!countryStats[sale.nationality]) {
                    countryStats[sale.nationality] = {
                        ...countryMap[sale.nationality],
                        sales: 0,
                        revenue: 0
                    };
                }
                countryStats[sale.nationality].sales++;
                countryStats[sale.nationality].revenue += sale.amount;
            }
        });

        return Object.values(countryStats);
    }

    // Get all dates that have a saved summary
    async getAvailableDates() {
        return await this.all('SELECT date FROM daily_summaries ORDER BY date DESC');
    }

    // Get saved summary for a specific date
    async getDailySummary(date) {
        return await this.get('SELECT * FROM daily_summaries WHERE date = ?', [date]);
    }

    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                } else {
                    console.log('Database connection closed');
                }
            });
        }
    }
}

module.exports = Database;