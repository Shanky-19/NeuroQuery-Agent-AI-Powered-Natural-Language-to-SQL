# Security Configuration Guide

## Environment Variables Setup

Before running this application, you need to set up your environment variables:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Update the following sensitive values in your `.env` file:

### Required API Keys
- `OPENAI_API_KEY`: Get your API key from https://platform.openai.com/api-keys

### Database Configuration
- `DB_PASSWORD`: Set a secure password for your database
- `DB_USER`: Configure your database username

### Production Security Checklist

- [ ] Never commit `.env` files to version control
- [ ] Use strong, unique passwords for all services
- [ ] Enable SSL/TLS in production (`DB_SSL=true`)
- [ ] Configure proper firewall rules
- [ ] Use environment-specific configuration
- [ ] Regularly rotate API keys and passwords
- [ ] Monitor logs for security issues

## Files That Should Never Be Committed

The `.gitignore` file prevents these sensitive files from being committed:
- `.env*` (all environment files)
- `*.log` (log files)
- `node_modules/`
- Certificates and keys (`*.pem`, `*.key`, etc.)

## Docker Security

When using Docker Compose:
- Override default passwords in production
- Use Docker secrets for sensitive data
- Don't expose unnecessary ports
- Use non-root users in containers