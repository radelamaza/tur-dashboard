# 🚀 Tour.com Dashboard de Ventas Diarias en Tiempo Real

Dashboard interactivo que muestra **solo las ventas del día actual** de Tour.com, con limpieza automática diaria y seguimiento de récords históricos.

## ✨ Características

- 📊 **Enfoque diario**: Solo muestra ventas del día actual
- 🗺️ **Mapa de Latinoamérica**: Visualiza ventas por país con puntitos escalables
- 🏆 **Récords históricos**: Tracking de mejores días de ventas
- 🧿 **Limpieza automática**: Borra datos del sheet al final del día
- 📈 **Gráficos en tiempo real**: Ventas por hora, top 5 productos, monedas
- 🔄 **Actualizaciones live**: Refresco cada 5 minutos + WebSockets
- 📱 **Responsive**: Funciona en todos los dispositivos

## 🎯 KPIs Mostrados

### Métricas Principales
- Número de ventas hoy
- Ingresos del día (convertidos a USD)
- Ventas del mes
- Venta promedio

### Gráficos
- **Ventas por hora**: Actividad de ventas a lo largo del día
- **Top productos**: Los tours más vendidos
- **Distribución por moneda**: CLP, USD, ARS, BRL
- **Top operadores**: Ingresos por operador

### Datos en Tiempo Real
- Lista de ventas recientes
- Notificaciones de nuevas ventas
- Estado de conexión en vivo

## 🚀 Instalación y Uso

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
El archivo `.env` ya está configurado con tu Google Sheet:
```env
GOOGLE_SHEETS_ID=1q1WjPguhUlfct_duJA3gOOrSWuF-g67YlTieay8NtPs
PORT=3000
DATA_REFRESH_INTERVAL=5
```

### 3. Ejecutar el dashboard
```bash
# Modo desarrollo (con auto-restart)
npm run dev

# Modo producción
npm start
```

### 4. Abrir el dashboard
Ve a: **http://localhost:3000**

## 📂 Estructura del Proyecto

```
tur-dashboard/
├── src/
│   ├── server.js          # Servidor Express + Socket.IO
│   └── dataFetcher.js     # Conexión a Google Sheets
├── public/
│   ├── index.html         # Frontend del dashboard
│   └── dashboard.js       # JavaScript del cliente
├── config/
├── .env                   # Variables de entorno
└── README.md             # Este archivo
```

## 🔧 Configuración

### Google Sheets
El dashboard está configurado para leer de tu Google Sheet público:
- **ID del Sheet**: `1q1WjPguhUlfct_duJA3gOOrSWuF-g67YlTieay8NtPs`
- **Formato esperado**: Columna `raw_message` con notificaciones de Slack
- **Actualización**: Cada 5 minutos (configurable)

### Parseo de Datos
El sistema extrae automáticamente de cada notificación:
- ID de reserva
- Nombre del producto/tour
- Fecha y hora
- Monto y moneda
- Operador
- Cliente y nacionalidad

### Conversión de Monedas
Todas las métricas se convierten a USD usando tasas aproximadas:
- CLP: 1 CLP = 0.001 USD
- ARS: 1 ARS = 0.001 USD  
- BRL: 1 BRL = 0.2 USD
- USD: 1 USD = 1 USD

## 🌐 Deployment

### Localhost (Desarrollo)
```bash
npm run dev
```

### Servidor (Producción)
```bash
npm start
```

### Variables de Entorno para Producción
```env
NODE_ENV=production
PORT=80
DATA_REFRESH_INTERVAL=2  # Más frecuente en producción
```

## 🔄 Funcionalidades en Tiempo Real

- **WebSocket**: Conexión persistente para actualizaciones instantáneas
- **Notificaciones**: Alertas cuando hay nuevas ventas
- **Estado de conexión**: Indicador visual del estado en vivo
- **Refresco automático**: Sin necesidad de recargar la página

## 🎨 Personalización

### Cambiar intervalo de actualización
Modifica `DATA_REFRESH_INTERVAL` en `.env` (en minutos)

### Cambiar tasas de cambio
Edita las tasas en `src/dataFetcher.js`:
```javascript
const exchangeRates = {
    'CLP': 0.001,
    'USD': 1,
    'ARS': 0.001,
    'BRL': 0.2
};
```

### Modificar gráficos
Los gráficos usan Chart.js. Personaliza en `public/dashboard.js`

## 🐛 Troubleshooting

### "Error cargando datos"
- Verifica que el Google Sheet sea público
- Revisa la conexión a internet
- Confirma el ID del sheet en `.env`

### Dashboard no se actualiza
- Verifica el estado de conexión (debe estar 🟢)
- Revisa la consola del navegador por errores
- Confirma que el servidor esté corriendo

### Datos incorrectos
- Verifica el formato de las notificaciones en Slack
- Revisa los regex de parseo en `dataFetcher.js`

## 📈 Próximas Mejoras

- [ ] Alertas por email/Slack
- [ ] Filtros por fechas
- [ ] Exportar reportes
- [ ] Más métricas avanzadas
- [ ] Dashboard de comparación histórica

---

**¡Tu dashboard está listo!** 🎉

Ejecuta `npm run dev` y ve a http://localhost:3000 para verlo en acción.