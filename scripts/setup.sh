#!/bin/bash

# Setup script for Natural Language to SQL Chatbot
# This script sets up the development environment

set -e

echo "🚀 Setting up Natural Language to SQL Chatbot..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or later."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18 or later is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker."
    exit 1
fi

echo "✅ Docker version: $(docker --version)"

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose."
    exit 1
fi

echo "✅ Docker Compose version: $(docker-compose --version)"

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please update the .env file with your actual configuration values."
fi

# Create logs directory
mkdir -p logs

# Set up Git hooks (if in a Git repository)
if [ -d .git ]; then
    echo "🔧 Setting up Git hooks..."
    # You can add pre-commit hooks here
fi

# Start Docker services
echo "🐳 Starting Docker services..."
docker-compose up -d postgres redis

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo "✅ Docker services are running"
else
    echo "❌ Some Docker services failed to start"
    docker-compose logs
    exit 1
fi

# Run database migrations/setup
echo "🗄️  Setting up database..."
docker-compose exec -T postgres psql -U admin -d sample_db -f /docker-entrypoint-initdb.d/01-create-readonly-user.sql || true
docker-compose exec -T postgres psql -U admin -d sample_db -f /docker-entrypoint-initdb.d/02-sample-data.sql || true

# Run tests to verify setup
echo "🧪 Running tests to verify setup..."
npm test

echo "🎉 Setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Update your .env file with the correct OpenAI API key"
echo "2. Start the development server: npm run dev"
echo "3. Open http://localhost:3000 in your browser"
echo "4. Check the API documentation at http://localhost:3000/api/v1"
echo ""
echo "Useful commands:"
echo "- npm run dev          # Start development server"
echo "- npm test             # Run tests"
echo "- npm run lint         # Run linting"
echo "- docker-compose logs  # View service logs"
echo "- docker-compose down  # Stop services"