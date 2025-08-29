const redis = require('../config/redis')
const logger = require('../utils/logger')

class CacheService {
  constructor () {
    this.metrics = {
      hits: 0,
      misses: 0,
      errors: 0,
      totalRequests: 0
    }
  }

  /**
   * Enhanced get with metrics tracking
   */
  async get (key, options = {}) {
    const {
      fallback = null,
      trackMetrics = true,
      parseJSON = true
    } = options

    this.metrics.totalRequests++

    try {
      const value = await redis.get(key)

      if (value !== null) {
        if (trackMetrics) this.metrics.hits++
        logger.debug(`Cache HIT for key: ${key}`)

        if (parseJSON && typeof value === 'string') {
          try {
            return JSON.parse(value)
          } catch (parseError) {
            logger.warn(`Failed to parse cached JSON for key ${key}:`, parseError)
            // Auto-cleanup corrupted cache entry
            await this.del(key)
            if (trackMetrics) this.metrics.errors++
            return fallback
          }
        }
        return value
      }

      if (trackMetrics) this.metrics.misses++
      logger.debug(`Cache MISS for key: ${key}`)
      return fallback
    } catch (error) {
      if (trackMetrics) this.metrics.errors++
      logger.error(`Cache GET error for key ${key}:`, error)
      return fallback
    }
  }

  /**
   * Enhanced set with compression for large values
   */
  async set (key, value, ttl = 3600, options = {}) {
    const {
      compress = false,
      maxSize = 1024 * 1024, // 1MB default max
      stringifyJSON = true
    } = options

    try {
      let serializedValue = stringifyJSON ? JSON.stringify(value) : value

      // Check size and optionally compress
      if (serializedValue.length > maxSize) {
        if (compress) {
          const zlib = require('zlib')
          serializedValue = zlib.gzipSync(serializedValue).toString('base64')
          key = `${key}:compressed`
        } else {
          logger.warn(`Cache value too large for key ${key}: ${serializedValue.length} bytes`)
          return false
        }
      }

      await redis.set(key, serializedValue, ttl)
      logger.debug(`Cache SET for key: ${key}, TTL: ${ttl}s, Size: ${serializedValue.length} bytes`)
      return true
    } catch (error) {
      logger.error(`Cache SET error for key ${key}:`, error)
      return false
    }
  }

  /**
   * Get or set pattern (cache-aside)
   */
  async getOrSet (key, fetchFunction, ttl = 3600, options = {}) {
    try {
      // Try to get from cache first
      const cached = await this.get(key, options)
      if (cached !== null) {
        return cached
      }

      // Cache miss - fetch fresh data
      logger.debug(`Cache miss for ${key}, fetching fresh data`)
      const freshData = await fetchFunction()

      if (freshData !== null && freshData !== undefined) {
        await this.set(key, freshData, ttl, options)
      }

      return freshData
    } catch (error) {
      logger.error(`Cache getOrSet error for key ${key}:`, error)
      throw error
    }
  }

  /**
   * Multi-get operation
   */
  async mget (keys) {
    try {
      const pipeline = redis.client.pipeline()
      keys.forEach(key => pipeline.get(key))
      const results = await pipeline.exec()

      return results.map((result, index) => {
        if (result[0]) { // Error
          logger.error(`Multi-get error for key ${keys[index]}:`, result[0])
          return null
        }
        return result[1] ? JSON.parse(result[1]) : null
      })
    } catch (error) {
      logger.error('Cache multi-get error:', error)
      return keys.map(() => null)
    }
  }

  /**
   * Multi-set operation
   */
  async mset (keyValuePairs, ttl = 3600) {
    try {
      const pipeline = redis.client.pipeline()

      Object.entries(keyValuePairs).forEach(([key, value]) => {
        const serialized = JSON.stringify(value)
        pipeline.setex(key, ttl, serialized)
      })

      await pipeline.exec()
      logger.debug(`Cache multi-set completed for ${Object.keys(keyValuePairs).length} keys`)
      return true
    } catch (error) {
      logger.error('Cache multi-set error:', error)
      return false
    }
  }

  /**
   * Delete with pattern matching
   */
  async delPattern (pattern) {
    try {
      const keys = await redis.client.keys(pattern)
      if (keys.length > 0) {
        await redis.client.del(...keys)
        logger.info(`Deleted ${keys.length} cache keys matching pattern: ${pattern}`)
      }
      return keys.length
    } catch (error) {
      logger.error(`Cache delete pattern error for ${pattern}:`, error)
      return 0
    }
  }

  /**
   * Get cache statistics
   */
  getStats () {
    const hitRate = this.metrics.totalRequests > 0
      ? (this.metrics.hits / this.metrics.totalRequests * 100).toFixed(2)
      : 0

    return {
      ...this.metrics,
      hitRate: `${hitRate}%`,
      errorRate: this.metrics.totalRequests > 0
        ? (this.metrics.errors / this.metrics.totalRequests * 100).toFixed(2) + '%'
        : '0%'
    }
  }

  /**
   * Reset metrics
   */
  resetStats () {
    this.metrics = {
      hits: 0,
      misses: 0,
      errors: 0,
      totalRequests: 0
    }
  }

  /**
   * Cache warming - preload frequently accessed data
   */
  async warmCache (warmupFunctions) {
    logger.info('Starting cache warmup...')

    const results = await Promise.allSettled(
      warmupFunctions.map(async ({ key, fetchFn, ttl = 3600 }) => {
        try {
          const data = await fetchFn()
          await this.set(key, data, ttl)
          return { key, success: true }
        } catch (error) {
          logger.error(`Cache warmup failed for ${key}:`, error)
          return { key, success: false, error: error.message }
        }
      })
    )

    const successful = results.filter(r => r.value?.success).length
    logger.info(`Cache warmup completed: ${successful}/${results.length} successful`)

    return results.map(r => r.value)
  }

  /**
   * Cache health check
   */
  async healthCheck () {
    try {
      const testKey = 'health:check'
      const testValue = { timestamp: Date.now() }

      // Test write
      await this.set(testKey, testValue, 60)

      // Test read
      const retrieved = await this.get(testKey)

      // Test delete
      await redis.del(testKey)

      const isHealthy = retrieved && retrieved.timestamp === testValue.timestamp

      return {
        healthy: isHealthy,
        connected: redis.isConnected,
        stats: this.getStats(),
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      logger.error('Cache health check failed:', error)
      return {
        healthy: false,
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }
}

module.exports = new CacheService()
