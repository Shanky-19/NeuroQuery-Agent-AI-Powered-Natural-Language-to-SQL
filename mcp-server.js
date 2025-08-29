#!/usr/bin/env node

/**
 * MCP Server Entry Point
 * 
 * This script starts the Model Context Protocol server that exposes
 * the database as resources and tools for AI models to interact with.
 * 
 * Usage:
 *   node mcp-server.js
 * 
 * The server communicates via stdio and can be used by MCP-compatible
 * AI clients like Claude Desktop, VS Code extensions, etc.
 */

require('dotenv').config();

const DatabaseMCPServer = require('./src/mcp/server');
const logger = require('./src/utils/logger');

async function main() {
  try {
    logger.info('Starting MCP Database Server...');
    
    const server = new DatabaseMCPServer();
    await server.start();
    
    // Keep the process running
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down MCP server...');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down MCP server...');
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main();