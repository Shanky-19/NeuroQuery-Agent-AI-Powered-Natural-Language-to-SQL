const promClient = require('prom-client')
const logger = require('../utils/logger')

// Create a Registry to register the metrics
const register = new promClient.Registry()

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'nl-to-sql-api'
})

// Enable the collection of default metrics
promClient.collectDefaultMetrics({ register })

// Custom metrics
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register]
})

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register]
})

const databaseQueriesTotal = new promClient.Counter({
  name: 'database_queries_total',
  help: 'Total number of database queries',
  labelNames: ['type', 'status'],
  registers: [register]
})

const databaseQueryDuration = new promClient.Histogram({
  name: 'database_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['type'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register]
})

const llmRequestsTotal = new promClient.Counter({
  name: 'llm_requests_total',
  help: 'Total number of LLM requests',
  labelNames: ['model', 'status'],
  registers: [register]
})

const llmRequestDuration = new promClient.Histogram({
  name: 'llm_request_duration_seconds',
  help: 'Duration of LLM requests in seconds',
  labelNames: ['model'],
  buckets: [1, 2, 5, 10, 20, 30, 60],
  registers: [register]
})

const cacheHitsTotal = new promClient.Counter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['type'],
  registers: [register]
})

const cacheMissesTotal = new promClient.Counter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['type'],
  registers: [register]
})

const databaseConnectionsActive = new promClient.Gauge({
  name: 'database_connections_active',
  help: 'Number of active database connections',
  registers: [register]
})

const memoryUsage = new promClient.Gauge({
  name: 'nodejs_memory_usage_bytes',
  help: 'Node.js memory usage in bytes',
  labelNames: ['type'],
  registers: [register]
})

// Update memory usage metrics periodically
setInterval(() => {
  const usage = process.memoryUsage()
  memoryUsage.set({ type: 'rss' }, usage.rss)
  memoryUsage.set({ type: 'heapTotal' }, usage.heapTotal)
  memoryUsage.set({ type: 'heapUsed' }, usage.heapUsed)
  memoryUsage.set({ type: 'external' }, usage.external)
}, 10000)

// Middleware to track HTTP metrics
const trackHttpMetrics = (req, res, next) => {
  const start = Date.now()

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000
    const route = req.route ? req.route.path : req.path

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status: res.statusCode
    })

    httpRequestDuration.observe({
      method: req.method,
      route,
      status: res.statusCode
    }, duration)
  })

  next()
}

// Function to track database queries
const trackDatabaseQuery = (type, duration, success = true) => {
  databaseQueriesTotal.inc({
    type,
    status: success ? 'success' : 'error'
  })

  if (success) {
    databaseQueryDuration.observe({ type }, duration / 1000)
  }
}

// Function to track LLM requests
const trackLLMRequest = (model, duration, success = true) => {
  llmRequestsTotal.inc({
    model,
    status: success ? 'success' : 'error'
  })

  if (success) {
    llmRequestDuration.observe({ model }, duration / 1000)
  }
}

// Function to track cache operations
const trackCacheHit = (type) => {
  cacheHitsTotal.inc({ type })
}

const trackCacheMiss = (type) => {
  cacheMissesTotal.inc({ type })
}

// Function to update database connection count
const updateDatabaseConnections = (count) => {
  databaseConnectionsActive.set(count)
}

// Metrics endpoint
const metricsEndpoint = async (req, res) => {
  try {
    res.set('Content-Type', register.contentType)
    const metrics = await register.metrics()
    res.end(metrics)
  } catch (error) {
    logger.error('Error generating metrics:', error)
    res.status(500).end('Error generating metrics')
  }
}

module.exports = {
  register,
  trackHttpMetrics,
  trackDatabaseQuery,
  trackLLMRequest,
  trackCacheHit,
  trackCacheMiss,
  updateDatabaseConnections,
  metricsEndpoint,

  // Export individual metrics for direct access if needed
  metrics: {
    httpRequestsTotal,
    httpRequestDuration,
    databaseQueriesTotal,
    databaseQueryDuration,
    llmRequestsTotal,
    llmRequestDuration,
    cacheHitsTotal,
    cacheMissesTotal,
    databaseConnectionsActive,
    memoryUsage
  }
}
