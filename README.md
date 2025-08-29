# Natural Language to SQL Chatbot

A real-time chatbot that translates natural language questions into safe, read-only SQL queries and returns paginated results.

## Architecture Overview

- **Backend API**: Node.js/Express orchestrating calls between components
- **Middleware Context Provider (MCP)**: Fetches and caches database schema metadata
- **LLM Integration**: OpenAI GPT-4 with function calling for SQL generation
- **Execution Layer**: Validates and executes read-only queries with security controls
- **Frontend**: Chat UI for user interaction

## Key Features

- Natural language to SQL translation
- Read-only query validation and execution
- Schema caching and metadata management
- Pagination and result formatting
- Rate limiting and cost control
- Comprehensive monitoring and logging

## Security & Safety

- Whitelist-based query validation (SELECT only)
- Read-only database account
- Dynamic schema filtering
- Dry-run EXPLAIN plan checks
- Query result caching

## Implementation Phases

1. Discovery and Design
2. Infrastructure Setup
3. MCP Development
4. LLM Integration
5. Execution Layer
6. Frontend Development
7. Testing & Validation
8. Production Deployment

## Getting Started

[Instructions will be added as components are implemented]