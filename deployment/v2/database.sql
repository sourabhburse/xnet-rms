-- Run in psql as the existing PostgreSQL administrator.
-- Creates only RMS objects. Password is prompted by psql, not committed here.
\set ON_ERROR_STOP on
CREATE ROLE xnet_rms LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password xnet_rms
CREATE DATABASE xnet_rms OWNER xnet_rms;
REVOKE ALL ON DATABASE xnet_rms FROM PUBLIC;
\connect xnet_rms
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE,CREATE ON SCHEMA public TO xnet_rms;
