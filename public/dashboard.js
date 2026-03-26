const socket = io();

let charts = { salesByHour: null, operators: null };

const el = {
    status: document.getElementById('statusText'),
    loading: document.getElementById('loading'),
    dashboard: document.getElementById('dashboard'),
    todaySales: document.getElementById('todaySales'),
    totalSales: document.getElementById('totalSales'),
    recordSales: document.getElementById('recordSales'),
    recordDate: document.getElementById('recordDate'),
    countriesCount: document.getElementById('countriesCount'),
    recentSalesList: document.getElementById('recentSalesList'),
    lastUpdate: document.getElementById('lastUpdate'),
    notification: document.getElementById('notification'),
    notificationText: document.getElementById('notificationText')
};

const colors = {
    blue: '#3b82f6',
    green: '#22c55e',
    yellow: '#eab308',
    red: '#ef4444',
    purple: '#8b5cf6',
    grey200: '#27272a',
    grey400: '#71717a',
    grey700: '#a1a1aa',
    grey900: '#fafafa'
};

const chartPalette = [colors.blue, colors.green, colors.yellow, colors.red, colors.purple];

// Chart.js global defaults
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = colors.grey400;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.padding = 16;

// Socket events
socket.on('connect', () => {
    el.status.textContent = '● En vivo';
    document.getElementById('status').className = 'header-status online';
});

socket.on('disconnect', () => {
    el.status.textContent = '● Desconectado';
    document.getElementById('status').className = 'header-status offline';
});

socket.on('salesUpdate', (data) => {
    updateDashboard(data);
    if (data.newSalesCount > 0) showNotification(`${data.newSalesCount} nueva(s) venta(s)`);
});

socket.on('newDay', () => {
    el.todaySales.textContent = '0';
    el.totalSales.textContent = '$0';
    el.countriesCount.textContent = '0';
});

function updateDashboard(data) {
    const { analytics } = data;
    el.loading.style.display = 'none';
    el.dashboard.style.display = 'block';

    el.todaySales.textContent = analytics.today.sales;
    el.totalSales.textContent = '$' + analytics.today.revenue.toLocaleString();
    el.countriesCount.textContent = analytics.salesByCountry ? analytics.salesByCountry.length : 0;

    if (analytics.records && analytics.records.daily_sales) {
        el.recordSales.textContent = analytics.records.daily_sales.record_value;
        el.recordDate.textContent = new Date(analytics.records.daily_sales.record_date).toLocaleDateString();
    }

    updateSalesByHourChart(analytics.salesByHour);
    updateOperatorsChart(analytics.topOperators);
    updateTopProductsTable(analytics.topProducts);
    updateCountryTable(analytics.salesByNationality || []);
    updateRecentSales(analytics.recentSales);

    if (analytics.lastUpdate) {
        el.lastUpdate.textContent = 'Última actualización: ' + new Date(analytics.lastUpdate).toLocaleTimeString();
    }
}

function updateSalesByHourChart(data) {
    const ctx = document.getElementById('salesByHourChart').getContext('2d');
    if (charts.salesByHour) charts.salesByHour.destroy();

    charts.salesByHour = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
            datasets: [{
                label: 'Ventas',
                data: data,
                borderColor: colors.blue,
                backgroundColor: colors.blue + '15',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
                y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grey200 } }
            }
        }
    });
}

function updateTopProductsTable(data) {
    const container = document.getElementById('topProductsTable');
    if (!data || data.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px">Sin productos</p>';
        return;
    }

    let html = `<table class="sales-table">
        <thead><tr>
            <th>Producto</th>
            <th style="text-align:right">Transacciones</th>
            <th style="text-align:right">Ingresos (CLP)</th>
        </tr></thead><tbody>`;

    data.forEach(item => {
        html += `<tr>
            <td>${item.product}</td>
            <td class="amount">${item.count}</td>
            <td class="amount">$${item.revenue.toLocaleString()}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function updateCountryTable(data) {
    const container = document.getElementById('salesByCountryTable');
    if (!data || data.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px">Sin datos</p>';
        return;
    }

    let html = `<table class="sales-table">
        <thead><tr>
            <th>País</th>
            <th style="text-align:right">Transacciones</th>
            <th style="text-align:right">Ingresos (CLP)</th>
        </tr></thead><tbody>`;

    data.forEach(item => {
        html += `<tr>
            <td><span class="nationality">${item.country}</span></td>
            <td class="amount">${item.count}</td>
            <td class="amount">$${item.revenue.toLocaleString()}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function updateOperatorsChart(data) {
    const ctx = document.getElementById('operatorsChart').getContext('2d');
    if (charts.operators) charts.operators.destroy();

    const labels = data.map(item => {
        const op = item.operator || 'N/A';
        return op.length > 20 ? op.substring(0, 20) + '...' : op;
    });

    charts.operators = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data.map(item => item.revenue),
                backgroundColor: colors.blue + '80',
                borderColor: colors.blue,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: colors.grey200 },
                    ticks: { callback: v => '$' + v.toLocaleString() }
                },
                y: { grid: { display: false } }
            }
        }
    });
}

function updateRecentSales(sales) {
    if (!sales || sales.length === 0) {
        el.recentSalesList.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px">Sin ventas recientes</p>';
        return;
    }

    let html = `<table class="sales-table">
        <thead><tr>
            <th>Producto</th>
            <th>Operador</th>
            <th>Cliente</th>
            <th>País</th>
            <th>Hora</th>
            <th style="text-align:right">Monto</th>
        </tr></thead><tbody>`;

    sales.forEach(sale => {
        const time = new Date(sale.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        html += `<tr>
            <td>${sale.product || '-'}</td>
            <td>${sale.operator || '-'}</td>
            <td>${sale.client || '-'}</td>
            <td><span class="nationality">${sale.nationality || '-'}</span></td>
            <td>${time}</td>
            <td class="amount">$${sale.amount.toLocaleString()} ${sale.currency}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    el.recentSalesList.innerHTML = html;
}

function showNotification(message) {
    el.notificationText.textContent = message;
    el.notification.classList.add('show');
    setTimeout(() => el.notification.classList.remove('show'), 3000);
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/sales')
        .then(r => r.json())
        .then(data => updateDashboard(data))
        .catch(() => { el.loading.textContent = 'Error cargando datos...'; });
});