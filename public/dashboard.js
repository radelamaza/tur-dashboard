// Initialize Socket.IO connection
const socket = io();

// Chart instances
let charts = {
    salesByHour: null,
    topProducts: null,
    currency: null,
    operators: null
};

// Elements
const elements = {
    status: document.getElementById('statusText'),
    loading: document.getElementById('loading'),
    dashboard: document.getElementById('dashboard'),
    todaySales: document.getElementById('todaySales'),
    todayRevenue: document.getElementById('todayRevenue'),
    totalSales: document.getElementById('totalSales'),
    recordSales: document.getElementById('recordSales'),
    recordDate: document.getElementById('recordDate'),
    countriesCount: document.getElementById('countriesCount'),
    recentSalesList: document.getElementById('recentSalesList'),
    lastUpdate: document.getElementById('lastUpdate'),
    notification: document.getElementById('notification'),
    notificationText: document.getElementById('notificationText')
};

// Connection status
socket.on('connect', () => {
    elements.status.textContent = '🟢 Conectado en tiempo real';
    document.getElementById('status').className = 'status online';
});

socket.on('disconnect', () => {
    elements.status.textContent = '🔴 Desconectado';
    document.getElementById('status').className = 'status offline';
});

// Sales data updates
socket.on('salesUpdate', (data) => {
    updateDashboard(data);
    
    if (data.newSalesCount > 0) {
        showNotification(`🎉 ${data.newSalesCount} nueva(s) venta(s)!`);
    }
});

// New day event
socket.on('newDay', (data) => {
    showNotification('🌅 ¡Nuevo día! Dashboard reiniciado.');
    
    // Reset dashboard
    elements.todaySales.textContent = '0';
    elements.todayRevenue.textContent = '$0 CLP';
    elements.totalSales.textContent = '$0';
    elements.countriesCount.textContent = '0';
    
    console.log('New day started:', data);
});

// Update dashboard with new data
function updateDashboard(data) {
    const { analytics } = data;
    
    // Hide loading and show dashboard
    elements.loading.style.display = 'none';
    elements.dashboard.style.display = 'block';
    
    // Update daily metrics (showing CLP)
    elements.todaySales.textContent = analytics.today.sales;
    elements.todayRevenue.textContent = `$${analytics.today.revenue.toLocaleString()} CLP`;
    elements.totalSales.textContent = `$${analytics.today.revenue.toLocaleString()}`;
    
    // Update records
    if (analytics.records && analytics.records.daily_sales) {
        elements.recordSales.textContent = analytics.records.daily_sales.record_value;
        elements.recordDate.textContent = new Date(analytics.records.daily_sales.record_date).toLocaleDateString();
    }
    
    // Update countries count
    elements.countriesCount.textContent = analytics.salesByCountry ? analytics.salesByCountry.length : 0;
    
    // Update charts
    updateSalesByHourChart(analytics.salesByHour);
    updateTopProductsChart(analytics.topProducts.slice(0, 5)); // Top 5 only
    updateCurrencyChart(analytics.salesByCurrency);
    updateOperatorsChart(analytics.topOperators);
    
    // Update recent sales
    updateRecentSales(analytics.recentSales);
    
    // Update last update time
    if (analytics.lastUpdate) {
        const updateTime = new Date(analytics.lastUpdate);
        elements.lastUpdate.textContent = `Última actualización: ${updateTime.toLocaleTimeString()}`;
    }
}

// Chart configurations for dark theme
const chartColors = {
    primary: '#667eea',
    secondary: '#764ba2', 
    accent: '#f093fb',
    success: '#22c55e',
    warning: '#f59e0b',
    background: 'rgba(102, 126, 234, 0.1)',
    grid: 'rgba(255, 255, 255, 0.1)',
    text: 'rgba(255, 255, 255, 0.8)'
};


// Sales by hour chart
function updateSalesByHourChart(data) {
    const ctx = document.getElementById('salesByHourChart').getContext('2d');
    
    if (charts.salesByHour) {
        charts.salesByHour.destroy();
    }
    
    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    
    charts.salesByHour = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ventas',
                data: data,
                borderColor: chartColors.primary,
                backgroundColor: chartColors.background,
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: chartColors.text
                    },
                    grid: {
                        color: chartColors.grid
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        color: chartColors.text
                    },
                    grid: {
                        color: chartColors.grid
                    }
                }
            }
        }
    });
}

// Top products chart
function updateTopProductsChart(data) {
    const ctx = document.getElementById('topProductsChart').getContext('2d');
    
    if (charts.topProducts) {
        charts.topProducts.destroy();
    }
    
    const labels = data.map(item => {
        const product = item.product;
        return product.length > 30 ? product.substring(0, 30) + '...' : product;
    });
    const values = data.map(item => item.count);
    
    charts.topProducts = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: [
                    chartColors.primary,
                    chartColors.secondary,
                    chartColors.accent,
                    chartColors.success,
                    chartColors.warning
                ]
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        color: chartColors.text
                    }
                }
            }
        }
    });
}

// Currency distribution chart
function updateCurrencyChart(data) {
    const ctx = document.getElementById('currencyChart').getContext('2d');
    
    if (charts.currency) {
        charts.currency.destroy();
    }
    
    const currencies = Object.keys(data);
    const amounts = Object.values(data);
    
    charts.currency = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: currencies,
            datasets: [{
                data: amounts,
                backgroundColor: [
                    chartColors.primary,
                    chartColors.secondary,
                    chartColors.accent,
                    chartColors.success
                ]
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: chartColors.text,
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const currency = context.label;
                            const amount = context.parsed;
                            return `${currency}: ${amount.toLocaleString()}`;
                        }
                    }
                }
            }
        }
    });
}

// Top operators chart
function updateOperatorsChart(data) {
    const ctx = document.getElementById('operatorsChart').getContext('2d');
    
    if (charts.operators) {
        charts.operators.destroy();
    }
    
    const labels = data.map(item => {
        const operator = item.operator;
        return operator && operator.length > 20 ? operator.substring(0, 20) + '...' : operator || 'N/A';
    });
    const revenues = data.map(item => item.revenue);
    
    charts.operators = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ingresos USD',
                data: revenues,
                backgroundColor: chartColors.primary,
                borderColor: chartColors.primary,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: chartColors.text,
                        maxRotation: 45
                    },
                    grid: {
                        color: chartColors.grid
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: chartColors.text,
                        callback: function(value) {
                            return '$' + value.toLocaleString() + ' CLP';
                        }
                    },
                    grid: {
                        color: chartColors.grid
                    }
                }
            }
        }
    });
}

// Update recent sales list
function updateRecentSales(sales) {
    elements.recentSalesList.innerHTML = '';
    
    if (!sales || sales.length === 0) {
        elements.recentSalesList.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No hay ventas recientes</div>';
        return;
    }
    
    sales.forEach((sale, index) => {
        const saleElement = document.createElement('div');
        saleElement.className = 'sale-item';
        
        if (index < 3) { // Highlight first 3 as "new"
            saleElement.classList.add('new-sale');
        }
        
        const saleDate = new Date(sale.date);
        const timeString = saleDate.toLocaleTimeString();
        
        saleElement.innerHTML = `
            <div class="sale-info">
                <div class="sale-product">${sale.product}</div>
                <div class="sale-details">
                    ${sale.client || 'Cliente'} (${sale.nationality || '--'}) • 
                    ${sale.operator || 'Operador'} • 
                    ${timeString}
                </div>
            </div>
            <div class="sale-amount">
                ${sale.amount.toLocaleString()} ${sale.currency}
            </div>
        `;
        
        elements.recentSalesList.appendChild(saleElement);
    });
}

// Show notification
function showNotification(message) {
    elements.notificationText.textContent = message;
    elements.notification.classList.add('show');
    
    setTimeout(() => {
        elements.notification.classList.remove('show');
    }, 3000);
}

// Format currency
function formatCurrency(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(amount);
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    console.log('Dashboard initialized');
    
    
    // Load initial data
    fetch('/api/sales')
        .then(response => response.json())
        .then(data => {
            updateDashboard(data);
        })
        .catch(error => {
            console.error('Error loading initial data:', error);
            elements.loading.innerHTML = 'Error cargando datos. Reintentando...';
        });
});
