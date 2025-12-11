# Multi-Tenant Architecture

Sparky supports multi-tenant operation where each user's API credentials are stored in SignalStudio (Supabase) and loaded dynamically per-trade.

## Overview

```
SignalStudio (Supabase)
├── bot_credentials table
│   ├── User A → Aster API keys
│   ├── User A → OANDA API keys
│   ├── User B → Aster API keys
│   └── User B → Tradier API keys
│
Webhook arrives with user_id
        ↓
Sparky loads user's credentials
        ↓
Creates exchange API instance
        ↓
Executes trade
        ↓
Logs to user's trades/positions
```

## Key Components

### 1. Credential Loading

**File:** `src/supabaseClient.js`

```javascript
async function getUserExchangeCredentials(userId, exchange) {
  // Check Redis cache first (5 min TTL)
  // Fall back to Supabase query
  // Returns: { apiKey, apiSecret, accountId, ... }
}
```

### 2. Dynamic Exchange Factory

**File:** `src/exchanges/ExchangeFactory.js`

```javascript
static async createExchangeForUser(userId, exchangeName) {
  // Load user's credentials from Supabase
  // Map to exchange-specific config
  // Create and return exchange API instance
}
```

### 3. Webhook Handler

**File:** `src/index.js`

```javascript
// When webhook arrives with user_id:
const exchangeApi = await ExchangeFactory.createExchangeForUser(userId, exchange);
const executor = new TradeExecutor(exchangeApi, positionTracker, config, exchange);
const result = await executor.executeWebhook(alertData, userId);
```

---

## Configuration

### Environment Variables (`.env`)

```bash
# Required
NODE_ENV=production
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_key_here

# Recommended (for caching)
REDIS_URL=redis://...

# Optional
LOG_LEVEL=info
```

### config.json

In multi-tenant mode, `config.json` is minimal:

```json
{}
```

All credentials and settings come from SignalStudio's database.

---

## Database Tables

### bot_credentials

Stores user's exchange API credentials:

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | User's ID |
| `exchange` | TEXT | Exchange name (aster, oanda, tradier) |
| `api_key` | TEXT | API key |
| `api_secret` | TEXT | API secret |
| `account_id` | TEXT | Account ID (for OANDA, Tradier) |
| `environment` | TEXT | 'production' or 'sandbox' |
| `extra_config` | JSONB | Additional exchange-specific config |

### positions

Multi-tenant position tracking:

```sql
UNIQUE (user_id, symbol)  -- Each user can have one position per symbol
```

### trades

Multi-tenant trade history - all trades include `user_id` for RLS.

---

## Redis Caching

Credentials are cached in Redis for performance:

```javascript
// Cache key format
`credentials:${userId}:${exchange}`

// TTL: 60 seconds
```

If Redis is unavailable, falls back to direct Supabase queries.

---

## Security

1. **Service Role Key** - Sparky uses Supabase service role for full DB access
2. **RLS Bypass** - Service role bypasses RLS for multi-user operations
3. **No Hardcoded Secrets** - All credentials in Supabase, not config files
4. **User Isolation** - Each trade tagged with user_id

---

## Migrating from Single-Tenant

### Before (config.json)

```json
{
  "aster": {
    "apiKey": "hardcoded_key",
    "apiSecret": "hardcoded_secret"
  }
}
```

### After (Supabase bot_credentials)

```sql
INSERT INTO bot_credentials (user_id, exchange, api_key, api_secret, environment)
VALUES ('user-uuid', 'aster', 'api_key', 'api_secret', 'production');
```

### Empty config.json

```json
{}
```

---

## Testing

### Test with user_id

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "your-user-uuid",
    "exchange": "aster",
    "action": "buy",
    "symbol": "ETHUSDT",
    "order_type": "market",
    "position_size_usd": 100
  }'
```

### Verify credentials loaded

Check logs for:
```
🔐 Loading aster credentials for user your-user-uuid...
✅ Loaded aster credentials for user (label: Main Account)
✅ Created aster executor for user your-user-uuid
```

---

**Version:** 1.1  
**Last Updated:** December 2025

