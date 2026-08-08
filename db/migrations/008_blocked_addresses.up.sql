CREATE TABLE IF NOT EXISTS blocked_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stellar_address TEXT UNIQUE NOT NULL,
    reason TEXT,
    blocked_by UUID REFERENCES admins(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
