#!/bin/bash

# Deployment script for Natural Language to SQL Chatbot
# Usage: ./scripts/deploy.sh [environment]

set -e

ENVIRONMENT=${1:-staging}
NAMESPACE="nl-to-sql-${ENVIRONMENT}"

echo "🚀 Deploying Natural Language to SQL Chatbot to ${ENVIRONMENT}..."

# Validate environment
if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    echo "❌ Invalid environment. Use 'staging' or 'production'"
    exit 1
fi

# Check if kubectl is installed and configured
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH"
    exit 1
fi

# Check if we can connect to the cluster
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster"
    exit 1
fi

echo "✅ Connected to Kubernetes cluster"

# Create namespace if it doesn't exist
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# Apply secrets (these should be created separately for security)
echo "🔐 Checking secrets..."
if ! kubectl get secret database-secret -n "$NAMESPACE" &> /dev/null; then
    echo "⚠️  database-secret not found in namespace $NAMESPACE"
    echo "Please create the secret with: kubectl create secret generic database-secret --from-literal=host=... --from-literal=port=... --from-literal=database=... --from-literal=username=... --from-literal=password=... -n $NAMESPACE"
fi

if ! kubectl get secret redis-secret -n "$NAMESPACE" &> /dev/null; then
    echo "⚠️  redis-secret not found in namespace $NAMESPACE"
    echo "Please create the secret with: kubectl create secret generic redis-secret --from-literal=url=... -n $NAMESPACE"
fi

if ! kubectl get secret openai-secret -n "$NAMESPACE" &> /dev/null; then
    echo "⚠️  openai-secret not found in namespace $NAMESPACE"
    echo "Please create the secret with: kubectl create secret generic openai-secret --from-literal=api-key=... -n $NAMESPACE"
fi

# Update image tag based on environment
if [ "$ENVIRONMENT" = "production" ]; then
    IMAGE_TAG="latest"
else
    IMAGE_TAG="develop"
fi

# Apply Kubernetes manifests
echo "📦 Applying Kubernetes manifests..."
sed "s|ghcr.io/your-org/nl-to-sql-chatbot:latest|ghcr.io/your-org/nl-to-sql-chatbot:${IMAGE_TAG}|g" k8s/deployment.yml | kubectl apply -n "$NAMESPACE" -f -

# Wait for deployment to be ready
echo "⏳ Waiting for deployment to be ready..."
kubectl rollout status deployment/nl-to-sql-api -n "$NAMESPACE" --timeout=300s

# Check if pods are running
echo "🔍 Checking pod status..."
kubectl get pods -n "$NAMESPACE" -l app=nl-to-sql-api

# Run health check
echo "🏥 Running health check..."
sleep 10
if kubectl get service nl-to-sql-api-service -n "$NAMESPACE" &> /dev/null; then
    # Port forward to test health endpoint
    kubectl port-forward service/nl-to-sql-api-service 8080:80 -n "$NAMESPACE" &
    PORT_FORWARD_PID=$!
    sleep 5
    
    if curl -f http://localhost:8080/health &> /dev/null; then
        echo "✅ Health check passed"
    else
        echo "❌ Health check failed"
        kill $PORT_FORWARD_PID 2>/dev/null || true
        exit 1
    fi
    
    kill $PORT_FORWARD_PID 2>/dev/null || true
fi

echo "🎉 Deployment to ${ENVIRONMENT} completed successfully!"

# Show useful information
echo ""
echo "Useful commands:"
echo "kubectl get pods -n $NAMESPACE"
echo "kubectl logs -f deployment/nl-to-sql-api -n $NAMESPACE"
echo "kubectl describe deployment nl-to-sql-api -n $NAMESPACE"
echo "kubectl port-forward service/nl-to-sql-api-service 3000:80 -n $NAMESPACE"