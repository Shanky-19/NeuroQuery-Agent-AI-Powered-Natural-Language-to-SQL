# Deployment Guide

## Quick Start

1. **Clone and Setup**
   ```bash
   git clone <repository>
   cd nl-to-sql-chatbot
   chmod +x scripts/setup.sh
   ./scripts/setup.sh
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your OpenAI API key and database settings
   ```

3. **Start Development**
   ```bash
   npm run dev
   # Visit http://localhost:3000
   ```

## Production Deployment

### Docker Compose (Recommended for testing)
```bash
docker-compose up -d
```

### Kubernetes (Production)
```bash
# Create secrets first
kubectl create secret generic database-secret \
  --from-literal=host=your-db-host \
  --from-literal=port=5432 \
  --from-literal=database=your-db \
  --from-literal=username=readonly_user \
  --from-literal=password=your-password

kubectl create secret generic redis-secret \
  --from-literal=url=redis://your-redis-host:6379

kubectl create secret generic openai-secret \
  --from-literal=api-key=your-openai-key

# Deploy
./scripts/deploy.sh production
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key (required) | - |
| `DB_HOST` | Database host | localhost |
| `DB_PORT` | Database port | 5432 |
| `DB_NAME` | Database name | sample_db |
| `DB_USER` | Database user | readonly_user |
| `DB_PASSWORD` | Database password | readonly_pass |
| `REDIS_URL` | Redis connection URL | redis://localhost:6379 |
| `NODE_ENV` | Environment | development |
| `PORT` | Server port | 3000 |

## Monitoring

- **Health Check**: `GET /health`
- **Metrics**: `GET /metrics` (Prometheus format)
- **Grafana Dashboard**: Available in `monitoring/grafana/`
- **Logs**: Structured JSON logs in `logs/` directory

## Security Checklist

- ✅ Read-only database user
- ✅ SQL injection protection
- ✅ Query validation (SELECT only)
- ✅ Rate limiting
- ✅ Input sanitization
- ✅ Secure headers (Helmet.js)
- ✅ Environment variable protection

## Performance Optimization

- ✅ Redis caching for schema and queries
- ✅ Database connection pooling
- ✅ Query pagination
- ✅ Relevant schema filtering
- ✅ Prometheus metrics collection

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check database credentials in `.env`
   - Ensure database is running and accessible
   - Verify read-only user exists

2. **OpenAI API Errors**
   - Verify API key is correct
   - Check API quota and billing
   - Monitor rate limits

3. **Redis Connection Issues**
   - Check Redis URL in environment
   - Ensure Redis server is running
   - Verify network connectivity

4. **High Memory Usage**
   - Monitor query result sizes
   - Adjust pagination settings
   - Check for memory leaks in logs

### Debug Commands

```bash
# Check service status
docker-compose ps

# View logs
docker-compose logs api
docker-compose logs postgres
docker-compose logs redis

# Test database connection
docker-compose exec postgres psql -U readonly_user -d sample_db -c "SELECT 1;"

# Test Redis connection
docker-compose exec redis redis-cli ping

# Run health check
curl http://localhost:3000/health
```