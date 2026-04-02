const https = require('https');
const Papa = require('papaparse');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

class GoogleSheetsDataFetcher {
    constructor(sheetId) {
        this.sheetId = sheetId;
        this.csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
        this.kpisCsvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=755669819`;
    }

    async fetchData() {
        try {
            console.log('🔗 Intentando conectar a:', this.csvUrl);
            const csvData = await this.fetchCSV(this.csvUrl);
            const parsedData = this.parseCSV(csvData);
            const salesData = this.processSalesData(parsedData);
            return salesData;
        } catch (error) {
            console.error('Error obteniendo datos:', error);
            throw error;
        }
    }

    // Returns raw parsed rows from index 89+ for debugging
    async fetchRawRows() {
        const csvData = await this.fetchCSV(this.csvUrl);
        const parsed = Papa.parse(csvData, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim()
        });
        return parsed.data.slice(89).map((row, i) => ({
            rowNumber: 90 + i,
            fecha: row.fecha,
            fecha_venta: row.fecha_venta,
            monto_clp: row.monto_clp,
            actividad: row.actividad,
            headers: Object.keys(row)
        }));
    }

    async fetchKpisDiarios() {
        try {
            const csvData = await this.fetchCSV(this.kpisCsvUrl);
            const parsed = Papa.parse(csvData, {
                header: true,
                skipEmptyLines: true,
                transformHeader: (h) => h.trim()
            });

            let bestDay = null;
            let bestAmount = 0;

            parsed.data.forEach(row => {
                const amount = parseFloat((row.ventas_dia_clp || '0').toString().replace(/\./g, '').replace(',', '.'));
                const count = parseInt(row.cantidad_ventas) || 0;
                const fecha = row.fecha ? row.fecha.trim() : null;

                if (fecha && amount > bestAmount) {
                    bestAmount = amount;
                    bestDay = { fecha, ventas_dia_clp: Math.round(amount), cantidad_ventas: count };
                }
            });

            console.log('🏆 Récord kpis diarios:', bestDay);
            return bestDay;
        } catch (error) {
            console.error('Error obteniendo kpis diarios:', error);
            return null;
        }
    }

    async fetchCSV(url = this.csvUrl) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                },
                redirect: 'follow' // Importante: seguir redirecciones
            });
            
            console.log('📡 Respuesta de Google Sheets:', response.status, response.headers.get('content-type'));
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.text();
            console.log('📄 Primeros 200 caracteres de la respuesta:', data.substring(0, 200));
            
            return data;
        } catch (error) {
            console.error('😱 Error en fetchCSV:', error);
            throw error;
        }
    }

    parseCSV(csvData) {
        console.log('🔍 Parseando CSV con PapaParse...');
        
        // Use PapaParse to handle complex CSV with quoted fields and line breaks
        const parsed = Papa.parse(csvData, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim()
        });
        
        if (parsed.errors.length > 0) {
            console.log('⚠️ Errores de CSV:', parsed.errors.slice(0, 3));
        }
        
        console.log('📋 Headers encontrados:', Object.keys(parsed.data[0] || {}));
        console.log('📋 Total filas parseadas:', parsed.data.length);
        
        // Log some sample rows to understand structure
        if (parsed.data.length > 90) {
            console.log('🔍 Fila 90 completa:', parsed.data[89]);
            console.log('🔍 Fila 91 completa:', parsed.data[90]);
        }
        
        return parsed.data;
    }

    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        result.push(current.trim());
        return result;
    }

    processSalesData(rawData) {
        const sales = [];

        console.log('🔍 Processing', rawData.length, 'rows from Google Sheets');

        // Filter only rows from index 89+ (row 90+) and process them
        rawData.forEach((row, index) => {
            if (index >= 89) { // Starting from row 90
                // Look for actual data in the row
                const hasData = Object.values(row).some(value => value && value.toString().trim());

                if (hasData) {
                    console.log(`Processing row ${index + 1}:`, row);

                    // Try to extract sale info directly from the columns
                    const sale = this.extractSaleFromColumns(row, index + 1);
                    if (sale) {
                        sales.push(sale);
                        console.log('✨ Parsed sale:', sale);
                    }
                }
            }
        });

        console.log('🏆 Total sales found:', sales.length);
        return sales;
    }

    // Like fetchData but returns ALL sales regardless of date (for backfill)
    async fetchAllData() {
        const csvData = await this.fetchCSV(this.csvUrl);
        const parsedData = this.parseCSV(csvData);
        const sales = [];

        parsedData.forEach((row, index) => {
            if (index < 89) return;
            const hasData = Object.values(row).some(v => v && v.toString().trim());
            if (!hasData) return;

            try {
                const utcDate = row.fecha_venta ? new Date(row.fecha_venta) : null;

                let fechaChile = (row.fecha || '').trim().split('T')[0].split(' ')[0];
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaChile)) {
                    const [dd, mm, yyyy] = fechaChile.split('/');
                    fechaChile = `${yyyy}-${mm}-${dd}`;
                }
                if (!fechaChile && utcDate) {
                    const chileDate = new Date(utcDate.getTime() - (3 * 60 * 60 * 1000));
                    fechaChile = chileDate.toISOString().split('T')[0];
                }

                const amount = parseFloat((row.monto_clp || '0').replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
                const product = row.actividad || 'Servicio de Tour';

                if (amount > 0 && product && fechaChile) {
                    let client = 'Unknown';
                    if (row.raw_message) {
                        const m = row.raw_message.match(/Cliente:\s*([^\n\r]+)/);
                        if (m) client = m[1].trim();
                    }
                    sales.push({
                        id: row.booking_id || `sale-${index}-${Date.now()}`,
                        product,
                        date: utcDate ? utcDate.toISOString() : `${fechaChile}T12:00:00.000Z`,
                        fechaChile,
                        amount,
                        currency: 'CLP',
                        operator: row.operador || 'Unknown',
                        client,
                        nationality: row.nacionalidad || 'XX',
                        timestamp: utcDate ? utcDate.getTime() : Date.now()
                    });
                }
            } catch (e) {
                console.error(`Error parsing row ${index + 1} in fetchAllData:`, e);
            }
        });

        console.log(`📦 fetchAllData: ${sales.length} total sales across all dates`);
        return sales;
    }

    // Extract sales using the correct column mapping from your sheet
    extractSaleFromColumns(row, rowNumber) {
        try {
            // Map the actual columns from your sheet:
            // timestamp_slack, raw_message, booking_id, actividad, fecha_venta, status, monto, Moneda, Peso, operador, nacionalidad, tipo_cambio, monto_clp
            
            // fecha_venta (UTC from Slack) — stored as-is so browser auto-converts to local time
            const utcDate = row.fecha_venta ? new Date(row.fecha_venta) : null;

            // fecha column has the correct Chile date (used only for day comparison)
            // Normalize to YYYY-MM-DD (sheet uses DD/MM/YYYY)
            let fechaChile = (row.fecha || '').trim().split('T')[0].split(' ')[0];
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaChile)) {
                const [dd, mm, yyyy] = fechaChile.split('/');
                fechaChile = `${yyyy}-${mm}-${dd}`;
            }
            // Fallback: if still empty/unrecognized, compute from utcDate adjusted to Chile (UTC-3)
            if (!fechaChile && utcDate) {
                const chileDate = new Date(utcDate.getTime() - (3 * 60 * 60 * 1000));
                fechaChile = chileDate.toISOString().split('T')[0];
            }

            const product = row.actividad || 'Servicio de Tour';
            const amount = parseFloat((row.monto_clp || '0').replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0; // Use monto_clp (already in CLP)
            const currency = 'CLP'; // Always CLP since monto_clp is in pesos
            const operator = row.operador || 'Unknown';
            const nationality = row.nacionalidad || 'XX';
            const bookingId = row.booking_id;
            const status = row.status;

            // Extract client name from raw_message if available
            let client = 'Unknown';
            if (row.raw_message) {
                const clientMatch = row.raw_message.match(/Cliente:\s*([^\n\r]+)/);
                if (clientMatch) {
                    client = clientMatch[1].trim();
                }
            }

            // Only process rows from 90+ that have the minimum required data
            if (rowNumber >= 90 && amount > 0 && product && fechaChile) {

                // Check if this sale is from today using fecha (already Chile date)
                const today = this.getTodayChile();

                if (fechaChile === today) {
                    console.log(`✅ VENTA DE HOY - Fila ${rowNumber}:`, {
                        fecha: fechaChile,
                        producto: product,
                        monto: `$${amount.toLocaleString()} CLP`,
                        operador: operator,
                        cliente: client,
                        nacionalidad: nationality,
                        booking_id: bookingId
                    });

                    return {
                        id: bookingId || `sale-${rowNumber}-${Date.now()}`,
                        product,
                        // UTC date — browser converts to local Chile time automatically
                        date: utcDate ? utcDate.toISOString() : `${fechaChile}T12:00:00.000Z`,
                        fechaChile, // Chile date for server-side day filtering
                        amount,
                        currency,
                        operator,
                        client,
                        nationality,
                        timestamp: utcDate ? utcDate.getTime() : Date.now()
                    };
                }
            }
            
            return null;
        } catch (error) {
            console.error(`Error parseando fila ${rowNumber}:`, error);
            return null;
        }
    }
    
    // Get today's date in Chilean timezone
    getTodayChile() {
        const now = new Date();
        const chileTime = new Date(now.getTime() - (3 * 60 * 60 * 1000)); // UTC-3
        return chileTime.toISOString().split('T')[0];
    }
    
    // Helper method to detect date strings
    isDateString(value) {
        if (!value) return false;
        const dateStr = value.toString().trim();
        
        // Check for common date formats
        const datePatterns = [
            /^\d{4}-\d{2}-\d{2}/, // 2024-03-17
            /^\d{2}\/\d{2}\/\d{4}/, // 17/03/2024
            /^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}/, // Tue Mar 17
            /^\d{1,2}\/\d{1,2}\/\d{4}/ // 3/17/2024
        ];
        
        return datePatterns.some(pattern => pattern.test(dateStr)) && !isNaN(Date.parse(dateStr));
    }

    // Keep original method for backward compatibility
    extractSaleInfo(message) {
        try {
            // Extract booking ID
            const idMatch = message.match(/id:\s*([a-f0-9-]+)/);
            const id = idMatch ? idMatch[1] : null;

            // Extract product name
            const productMatch = message.match(/para\s*`([^`]+)`/);
            const product = productMatch ? productMatch[1] : null;

            // Extract date
            const dateMatch = message.match(/Date:\s*`([^`]+)`/);
            const date = dateMatch ? new Date(dateMatch[1]) : null;

            // Extract amount and currency
            const amountMatch = message.match(/Monto:\s*([0-9,]+\.\d+)\s*([A-Z]+)/);
            const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;
            const currency = amountMatch ? amountMatch[2] : null;

            // Extract operator
            const operatorMatch = message.match(/Operador:\s*([^\\n]+)/);
            const operator = operatorMatch ? operatorMatch[1].trim() : null;

            // Extract client
            const clientMatch = message.match(/Cliente:\s*([^\\n]+)/);
            const client = clientMatch ? clientMatch[1].trim() : null;

            // Extract nationality
            const nationalityMatch = message.match(/Nacionalidad:\s*([A-Z]{2})/);
            const nationality = nationalityMatch ? nationalityMatch[1] : null;

            if (id && product && date && amount && currency) {
                return {
                    id,
                    product,
                    date: date.toISOString(),
                    amount,
                    currency,
                    operator,
                    client,
                    nationality,
                    timestamp: date.getTime()
                };
            }

            return null;
        } catch (error) {
            console.error('Error parsing sale info:', error);
            return null;
        }
    }

    // Convert all amounts to USD for unified calculations
    convertToUSD(amount, currency) {
        const exchangeRates = {
            'CLP': 0.001, // 1 CLP = 0.001 USD (approximate)
            'USD': 1,
            'ARS': 0.001, // 1 ARS = 0.001 USD (approximate)
            'BRL': 0.2    // 1 BRL = 0.2 USD (approximate)
        };

        return amount * (exchangeRates[currency] || 1);
    }
}

module.exports = GoogleSheetsDataFetcher;