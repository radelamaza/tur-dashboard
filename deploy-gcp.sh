#!/bin/bash

# Tur.com Dashboard - Deploy to Google Cloud Run
# Este script despliega el dashboard a GCP

# Variables
PROJECT_ID="tur-dashboard-prod"  # Cambia esto por tu Project ID de GCP
SERVICE_NAME="tur-dashboard"
REGION="us-central1"  # O la región que prefieras

echo "🚀 Desplegando Tur.com Dashboard a Google Cloud Run..."

# 1. Construir la imagen
echo "📦 Construyendo imagen Docker..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME

# 2. Desplegar a Cloud Run
echo "🌐 Desplegando a Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars NODE_ENV=production \
  --set-env-vars GOOGLE_SHEETS_ID=1q1WjPguhUlfct_duJA3gOOrSWuF-g67YlTieay8NtPs \
  --set-env-vars DATA_REFRESH_INTERVAL=2

echo "✅ ¡Dashboard desplegado exitosamente!"
echo "🔗 URL: https://$SERVICE_NAME-XXXXXXXX-$REGION.run.app"
echo "📊 Tu equipo de Tur ya puede acceder al dashboard"