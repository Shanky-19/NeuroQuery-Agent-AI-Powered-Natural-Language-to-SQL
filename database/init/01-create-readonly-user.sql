-- Create read-only user for the application
-- This script works for PostgreSQL

-- Create the readonly user
CREATE USER readonly_user WITH PASSWORD 'readonly_pass';

-- Grant connect privilege to the database
GRANT CONNECT ON DATABASE sample_db TO readonly_user;

-- Grant usage on the public schema
GRANT USAGE ON SCHEMA public TO readonly_user;

-- Grant select privileges on all existing tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;

-- Grant select privileges on all future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_user;

-- Grant usage on all sequences (for serial columns)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO readonly_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO readonly_user;

-- Ensure the user cannot create, modify, or delete anything
REVOKE CREATE ON SCHEMA public FROM readonly_user;
REVOKE ALL ON DATABASE sample_db FROM readonly_user;
GRANT CONNECT ON DATABASE sample_db TO readonly_user;