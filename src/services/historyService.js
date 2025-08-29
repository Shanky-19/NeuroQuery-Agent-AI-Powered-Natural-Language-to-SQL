const redis = require('../config/redis')
const cacheService = require('./cacheService')
const logger = require('../utils/logger')

class HistoryService {
  constructor () {
    this.historyPrefix = 'history:'
    this.userHistoryPrefix = 'user_history:'
    this.globalHistoryKey = 'global_history'
    this.maxHistoryPerUser = 100
    this.maxGlobalHistory = 1000
    this.historyTTL = 30 * 24 * 60 * 60 // 30 days
  }

  /**
   * Save a query to history
   */
  async saveQuery (queryData, userId = 'anonymous') {
    try {
      const historyEntry = {
        id: this.generateHistoryId(),
        userId,
        timestamp: new Date().toISOString(),
        naturalLanguageQuery: queryData.originalQuery,
        generatedSQL: queryData.generatedSQL,
        reasoning: queryData.reasoning,
        assumptions: queryData.assumptions,
        confidence: queryData.confidence,
        executionTime: queryData.result?.metadata?.executionTime || 0,
        rowCount: queryData.result?.rows?.length || 0,
        totalRows: queryData.result?.pagination?.totalRows || 0,
        success: !!queryData.result,
        error: queryData.error || null,
        schemaInfo: queryData.schemaInfo || null
      }

      // Save to user-specific history
      await this.addToUserHistory(userId, historyEntry)

      // Save to global history (for analytics)
      await this.addToGlobalHistory(historyEntry)

      // Index by query for quick lookup
      await this.indexQuery(historyEntry)

      logger.debug(`Query saved to history: ${historyEntry.id}`)
      return historyEntry.id
    } catch (error) {
      logger.error('Error saving query to history:', error)
      throw error
    }
  }

  /**
   * Get user's query history
   */
  async getUserHistory (userId = 'anonymous', options = {}) {
    try {
      const {
        limit = 20,
        offset = 0,
        includeErrors = true,
        sortBy = 'timestamp',
        sortOrder = 'desc'
      } = options

      const userHistoryKey = `${this.userHistoryPrefix}${userId}`

      // Get user's history list (stored as sorted set by timestamp)
      const historyIds = await redis.zrevrange(
        userHistoryKey,
        offset,
        offset + limit - 1
      )

      if (!historyIds || historyIds.length === 0) {
        return {
          entries: [],
          total: 0,
          hasMore: false
        }
      }

      // Get full history entries
      const entries = await this.getHistoryEntries(historyIds)

      // Filter out errors if requested
      const filteredEntries = includeErrors
        ? entries
        : entries.filter(entry => entry.success)

      // Sort if needed
      const sortedEntries = this.sortHistoryEntries(filteredEntries, sortBy, sortOrder)

      // Get total count
      const totalCount = await redis.zcard(userHistoryKey)

      return {
        entries: sortedEntries,
        total: totalCount,
        hasMore: offset + limit < totalCount,
        pagination: {
          limit,
          offset,
          total: totalCount
        }
      }
    } catch (error) {
      logger.error('Error getting user history:', error)
      throw error
    }
  }

  /**
   * Search query history
   */
  async searchHistory (searchTerm, userId = 'anonymous', options = {}) {
    try {
      const { limit = 10 } = options
      const userHistory = await this.getUserHistory(userId, { limit: 100 })

      const searchTermLower = searchTerm.toLowerCase()

      const matchingEntries = userHistory.entries.filter(entry => {
        return (
          entry.naturalLanguageQuery.toLowerCase().includes(searchTermLower) ||
          entry.generatedSQL.toLowerCase().includes(searchTermLower) ||
          (entry.reasoning && entry.reasoning.toLowerCase().includes(searchTermLower))
        )
      }).slice(0, limit)

      return {
        entries: matchingEntries,
        searchTerm,
        total: matchingEntries.length
      }
    } catch (error) {
      logger.error('Error searching history:', error)
      throw error
    }
  }

  /**
   * Get a specific history entry
   */
  async getHistoryEntry (historyId) {
    try {
      const entryKey = `${this.historyPrefix}entry:${historyId}`
      const entry = await cacheService.get(entryKey)

      if (!entry) {
        throw new Error('History entry not found')
      }

      return entry
    } catch (error) {
      logger.error(`Error getting history entry ${historyId}:`, error)
      throw error
    }
  }

  /**
   * Delete a history entry
   */
  async deleteHistoryEntry (historyId, userId = 'anonymous') {
    try {
      const entry = await this.getHistoryEntry(historyId)

      // Verify ownership
      if (entry.userId !== userId) {
        throw new Error('Unauthorized to delete this history entry')
      }

      // Remove from user history
      const userHistoryKey = `${this.userHistoryPrefix}${userId}`
      await redis.zrem(userHistoryKey, historyId)

      // Remove the entry itself
      const entryKey = `${this.historyPrefix}entry:${historyId}`
      await redis.del(entryKey)

      // Remove from query index
      await this.removeFromQueryIndex(entry)

      logger.debug(`History entry deleted: ${historyId}`)
      return true
    } catch (error) {
      logger.error(`Error deleting history entry ${historyId}:`, error)
      throw error
    }
  }

  /**
   * Clear user's history
   */
  async clearUserHistory (userId = 'anonymous') {
    try {
      const userHistoryKey = `${this.userHistoryPrefix}${userId}`

      // Get all history IDs for this user
      const historyIds = await redis.zrange(userHistoryKey, 0, -1)

      // Delete all entries
      if (historyIds.length > 0) {
        for (const id of historyIds) {
          const entryKey = `${this.historyPrefix}entry:${id}`
          await redis.del(entryKey)
        }
      }

      // Clear user's history list
      await redis.del(userHistoryKey)

      logger.info(`Cleared history for user: ${userId}, ${historyIds.length} entries`)
      return historyIds.length
    } catch (error) {
      logger.error(`Error clearing history for user ${userId}:`, error)
      throw error
    }
  }

  /**
   * Get popular queries (analytics)
   */
  async getPopularQueries (options = {}) {
    try {
      const { limit = 10 } = options

      // This would typically use a more sophisticated analytics approach
      // For now, we'll get recent successful queries and count similar ones
      const globalHistoryKey = `${this.historyPrefix}${this.globalHistoryKey}`
      const recentIds = await redis.zrevrange(globalHistoryKey, 0, 100)

      if (!recentIds.length) return []

      const entries = await this.getHistoryEntries(recentIds)
      const successfulEntries = entries.filter(e => e.success)

      // Group by similar queries (simplified)
      const queryGroups = {}
      successfulEntries.forEach(entry => {
        const key = entry.naturalLanguageQuery.toLowerCase().trim()
        if (!queryGroups[key]) {
          queryGroups[key] = {
            query: entry.naturalLanguageQuery,
            count: 0,
            lastUsed: entry.timestamp,
            avgExecutionTime: 0,
            totalExecutionTime: 0
          }
        }
        queryGroups[key].count++
        queryGroups[key].totalExecutionTime += entry.executionTime
        queryGroups[key].avgExecutionTime = queryGroups[key].totalExecutionTime / queryGroups[key].count
        if (entry.timestamp > queryGroups[key].lastUsed) {
          queryGroups[key].lastUsed = entry.timestamp
        }
      })

      return Object.values(queryGroups)
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
    } catch (error) {
      logger.error('Error getting popular queries:', error)
      throw error
    }
  }

  /**
   * Get history statistics
   */
  async getHistoryStats (userId = 'anonymous') {
    try {
      const userHistoryKey = `${this.userHistoryPrefix}${userId}`
      const totalQueries = await redis.zcard(userHistoryKey)

      if (totalQueries === 0) {
        return {
          totalQueries: 0,
          successfulQueries: 0,
          failedQueries: 0,
          avgExecutionTime: 0,
          mostRecentQuery: null
        }
      }

      // Get recent entries for analysis
      const recentIds = await redis.zrevrange(userHistoryKey, 0, 50)
      const recentEntries = await this.getHistoryEntries(recentIds)

      const successfulQueries = recentEntries.filter(e => e.success).length
      const failedQueries = recentEntries.filter(e => !e.success).length

      const avgExecutionTime = recentEntries.reduce((sum, e) => sum + (e.executionTime || 0), 0) / recentEntries.length

      return {
        totalQueries,
        successfulQueries,
        failedQueries,
        avgExecutionTime: Math.round(avgExecutionTime),
        mostRecentQuery: recentEntries[0] || null,
        recentQueriesAnalyzed: recentEntries.length
      }
    } catch (error) {
      logger.error('Error getting history stats:', error)
      throw error
    }
  }

  // Private helper methods

  generateHistoryId () {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  async addToUserHistory (userId, historyEntry) {
    const userHistoryKey = `${this.userHistoryPrefix}${userId}`
    const entryKey = `${this.historyPrefix}entry:${historyEntry.id}`

    // Store the full entry
    await cacheService.set(entryKey, historyEntry, this.historyTTL)

    // Add to user's sorted set (sorted by timestamp)
    const timestamp = new Date(historyEntry.timestamp).getTime()
    await redis.zadd(userHistoryKey, timestamp, historyEntry.id)

    // Trim to max history per user
    const count = await redis.zcard(userHistoryKey)
    if (count > this.maxHistoryPerUser) {
      await redis.zremrangebyrank(userHistoryKey, 0, count - this.maxHistoryPerUser - 1)
    }

    // Set TTL on user history
    await redis.expire(userHistoryKey, this.historyTTL)
  }

  async addToGlobalHistory (historyEntry) {
    const globalHistoryKey = `${this.historyPrefix}${this.globalHistoryKey}`
    const timestamp = new Date(historyEntry.timestamp).getTime()

    await redis.zadd(globalHistoryKey, timestamp, historyEntry.id)

    // Trim global history
    const count = await redis.zcard(globalHistoryKey)
    if (count > this.maxGlobalHistory) {
      await redis.zremrangebyrank(globalHistoryKey, 0, count - this.maxGlobalHistory - 1)
    }
  }

  async indexQuery (historyEntry) {
    // Simple indexing for search - could be enhanced with full-text search
    const queryWords = historyEntry.naturalLanguageQuery.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2)

    for (const word of queryWords) {
      const indexKey = `${this.historyPrefix}index:${word}`
      await redis.sadd(indexKey, historyEntry.id)
      await redis.expire(indexKey, this.historyTTL)
    }
  }

  async removeFromQueryIndex (historyEntry) {
    const queryWords = historyEntry.naturalLanguageQuery.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2)

    for (const word of queryWords) {
      const indexKey = `${this.historyPrefix}index:${word}`
      await redis.srem(indexKey, historyEntry.id)
    }
  }

  async getHistoryEntries (historyIds) {
    if (!historyIds.length) return []

    const entryKeys = historyIds.map(id => `${this.historyPrefix}entry:${id}`)
    return await cacheService.mget(entryKeys)
  }

  sortHistoryEntries (entries, sortBy, sortOrder) {
    const validEntries = entries.filter(entry => entry !== null)

    return validEntries.sort((a, b) => {
      let aVal, bVal

      switch (sortBy) {
        case 'timestamp':
          aVal = new Date(a.timestamp).getTime()
          bVal = new Date(b.timestamp).getTime()
          break
        case 'executionTime':
          aVal = a.executionTime || 0
          bVal = b.executionTime || 0
          break
        case 'confidence':
          aVal = a.confidence || 0
          bVal = b.confidence || 0
          break
        default:
          aVal = new Date(a.timestamp).getTime()
          bVal = new Date(b.timestamp).getTime()
      }

      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal
    })
  }
}

module.exports = new HistoryService()
