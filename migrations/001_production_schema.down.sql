-- Rollback for 001_production_schema.sql

drop table if exists platform_forms;
drop table if exists support_tickets;
drop table if exists runtime_state_snapshots;
drop table if exists history_entries;
drop table if exists projects;
drop table if exists subscriptions;
drop table if exists payment_events;
drop table if exists webhook_events;
drop table if exists assets;
drop table if exists models;
drop table if exists providers;
drop table if exists jobs;
drop table if exists credit_reservations;
drop table if exists credit_transactions;
drop table if exists wallets;
drop table if exists sessions;
drop table if exists users;
drop table if exists tenants;
