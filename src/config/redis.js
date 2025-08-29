const redis = require('redis')
const logger = require('../utils/logger')

class RedisConfig {
  constructor () {
    this.client = null
    this.isConnected = false
    this.ttl = parseInt(process.env.REDIS_TTL) || 3600 // 1 hour default
    this.initialize()
  }

  async initialize () {
    try {
      this.client = redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis server connection refused')
            return new Error('Redis server connection refused')
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            logger.error('Redis retry time exhausted')
            return new Error('Retry time exhausted')
          }
          if (options.attempt > 10) {
            logger.error('Redis max retry attempts reached')
            return undefined
          }
          return Math.min(options.attempt * 100, 3000)
        }
      })

      this.client.on('error', (err) => {
        logger.error('Redis client error:', err)
        this.isConnected = false
      })

      this.client.on('connect', () => {
        logger.info('Redis client connected')
        this.isConnected = true
      })

      this.client.on('ready', () => {
        logger.info('Redis client ready')
      })

      this.client.on('end', () => {
        logger.info('Redis client disconnected')
        this.isConnected = false
      })

      await this.client.connect()
    } catch (error) {
      logger.error('Failed to initialize Redis:', error)
      throw error
    }
  }

  async get (key) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping cache get')
        return null
      }

      const value = await this.client.get(key)
      if (value) {
        logger.debug(`Cache hit for key: ${key}`)
        try {
          return JSON.parse(value)
        } catch (parseError) {
          logger.error('Failed to parse cached value:', {
            key,
            value: value.substring(0, 100),
            error: parseError.message
          })
          // Delete corrupted cache entry
          await this.client.del(key)
          return null
        }
      }

      logger.debug(`Cache miss for key: ${key}`)
      return null
    } catch (error) {
      logger.error('Redis get error:', error)
      return null
    }
  }

  async set (key, value, ttl = this.ttl) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping cache set')
        return false
      }

      await this.client.setEx(key, ttl, JSON.stringify(value))
      logger.debug(`Cache set for key: ${key}, TTL: ${ttl}s`)
      return true
    } catch (error) {
      logger.error('Redis set error:', error)
      return false
    }
  }

  async del (key) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping cache delete')
        return false
      }

      await this.client.del(key)
      logger.debug(`Cache deleted for key: ${key}`)
      return true
    } catch (error) {
      logger.error('Redis delete error:', error)
      return false
    }
  }

  async flush () {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping cache flush')
        return false
      }

      await this.client.flushAll()
      logger.info('Cache flushed')
      return true
    } catch (error) {
      logger.error('Redis flush error:', error)
      return false
    }
  }

  // Expose additional Redis methods needed by other services
  async zadd (key, score, member) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping zadd')
        return false
      }
      return await this.client.zAdd(key, { score, value: member })
    } catch (error) {
      logger.error('Redis zadd error:', error)
      return false
    }
  }

  async zrevrange (key, start, stop) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping zrevrange')
        return []
      }
      return await this.client.zRevRange(key, start, stop)
    } catch (error) {
      logger.error('Redis zrevrange error:', error)
      return []
    }
  }

  async zcard (key) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping zcard')
        return 0
      }
      return await this.client.zCard(key)
    } catch (error) {
      logger.error('Redis zcard error:', error)
      return 0
    }
  }

  async zrem (key, member) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping zrem')
        return false
      }
      return await this.client.zRem(key, member)
    } catch (error) {
      logger.error('Redis zrem error:', error)
      return false
    }
  }

  async zrange (key, start, stop) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping zrange')
        return []
      }
      return await this.client.zRange(key, start, stop)
    } catch (error) {
      logger.error('Redis zrange error:', error)
      return []
    }
  }

  async zremrangebyrank (key, start, stop) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping zremrangebyrank')
        return false
      }
      return await this.client.zRemRangeByRank(key, start, stop)
    } catch (error) {
      logger.error('Redis zremrangebyrank error:', error)
      return false
    }
  }

  async expire (key, seconds) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping expire')
        return false
      }
      return await this.client.expire(key, seconds)
    } catch (error) {
      logger.error('Redis expire error:', error)
      return false
    }
  }

  async sadd (key, member) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping sadd')
        return false
      }
      return await this.client.sAdd(key, member)
    } catch (error) {
      logger.error('Redis sadd error:', error)
      return false
    }
  }

  async srem (key, member) {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping srem')
        return false
      }
      return await this.client.sRem(key, member)
    } catch (error) {
      logger.error('Redis srem error:', error)
      return false
    }
  }

  async flushAll () {
    try {
      if (!this.isConnected) {
        logger.warn('Redis not connected, skipping flushAll')
        return false
      }
      await this.client.flushAll()
      return true
    } catch (error) {
      logger.error('Redis flushAll error:', error)
      return false
    }
  }

  async close () {
    if (this.client) {
      await this.client.quit()
      logger.info('Redis client closed')
    }
  }
}

module.exports = new RedisConfig()
