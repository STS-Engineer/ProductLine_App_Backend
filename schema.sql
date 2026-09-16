-- ProductLine App — database schema reference
--
-- This is a snapshot of the actual production schema (Azure Postgres, database RFQ_DATA),
-- generated from information_schema — not a migration script. No migration tool is in use;
-- schema changes are applied manually against the live database. Keep this file in sync
-- when the schema changes.

-- ============================================================
-- users
-- ============================================================
CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    display_name   TEXT,
    password_hash  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_role      VARCHAR(10) NOT NULL DEFAULT 'user'  -- 'user' | 'admin'
);
-- Note: no updated_at/created_by/updated_by columns (unlike product_lines/products below).
-- dataController.js's getAllItems/updateItem special-case 'users' to account for this.

-- ============================================================
-- product_lines
-- ============================================================
CREATE TABLE product_lines (
    id                       BIGINT PRIMARY KEY,
    name                     TEXT NOT NULL UNIQUE,
    type_of_products         TEXT,
    manufacturing_locations  TEXT,
    design_center            TEXT,
    product_line_manager     TEXT,
    history                  TEXT,
    type_of_customers        TEXT,
    metiers                  TEXT,
    strength                 TEXT,
    weakness                 TEXT,
    perspectives             TEXT,
    compliance_resource_id   TEXT,
    attachments_raw          TEXT,  -- JSON-stringified array of Azure Blob Storage URLs
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               INTEGER,  -- users.id, no FK constraint defined
    updated_by               INTEGER,  -- users.id, no FK constraint defined
    updated_at               TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- products
-- ============================================================
CREATE TABLE products (
    id                            SERIAL PRIMARY KEY,
    product_name                  TEXT,
    product_line                  TEXT,  -- denormalized name, kept alongside product_line_id
    description                   TEXT,
    product_definition            TEXT,
    operating_environment         TEXT,
    technical_parameters          TEXT,
    machines_and_tooling          TEXT,
    manufacturing_strategy        TEXT,
    purchasing_strategy           TEXT,
    prototypes_ppap_and_sop       TEXT,
    engineering_and_testing       TEXT,
    capacity                      TEXT,
    our_advantages                TEXT,
    gmdc_pct                      NUMERIC,
    product_pictures              TEXT,  -- JSON-stringified array of Azure Blob Storage URLs
    product_line_id               BIGINT REFERENCES product_lines(id),
    customers_in_production       TEXT,
    customer_in_development       TEXT,
    level_of_interest_and_why     TEXT,
    estimated_price_per_product   TEXT,
    prod_if_customer_in_china     BOOLEAN,
    costing_data                  TEXT,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                    INTEGER,  -- users.id, no FK constraint defined
    updated_by                    INTEGER,  -- users.id, no FK constraint defined
    updated_at                    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- audit_logs
-- ============================================================
CREATE TABLE audit_logs (
    log_id      BIGSERIAL PRIMARY KEY,
    action      TEXT NOT NULL,  -- 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'SIGNUP'
    table_name  TEXT NOT NULL,
    document_id TEXT,
    user_id     TEXT NOT NULL,
    user_name   TEXT,
    logged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    details     JSONB
);
