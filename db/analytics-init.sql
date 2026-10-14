CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS clicks (
    time        TIMESTAMPTZ NOT NULL,
    short_code  VARCHAR(10) NOT NULL,
    user_agent  TEXT,
    referer     TEXT,
    ip          TEXT
);

-- Turn it into a hypertable, partitioned automatically by time
SELECT create_hypertable('clicks', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_clicks_code_time ON clicks (short_code, time DESC);