# Kalshi Exchange Setup Guide

This guide explains how to set up Kalshi API credentials in SignalStudio for use with Sparky.

---

## Step 1: Generate Kalshi API Keys

1. **Log in to Kalshi:**
   - Production: https://kalshi.com/
   - Demo: https://demo.kalshi.co/

2. **Navigate to API Keys:**
   - Click your profile icon (top-right)
   - Go to **Account Settings** → **API Keys**
   - Or directly: https://kalshi.com/account/profile

3. **Create New API Key:**
   - Click **"Create New API Key"**
   - You'll receive:
     - **Key ID** (e.g., `a952bcbe-ec3b-4b5b-b8f9-11dae589608c`)
     - **Private Key** (RSA_PRIVATE_KEY format - starts with `-----BEGIN RSA PRIVATE KEY-----`)

4. **⚠️ IMPORTANT: Save the Private Key Immediately**
   - The private key is shown **ONLY ONCE**
   - It cannot be retrieved later
   - Download the `.txt` file that's automatically generated
   - Store it securely

---

## Step 2: Save Credentials in SignalStudio

### Via SignalStudio UI

1. **Navigate to Settings:**
   - Go to SignalStudio dashboard
   - Click **Settings** → **Bot Credentials**

2. **Add Kalshi Credentials:**
   - Click **"Add Exchange"** or **"New Credential"**
   - Select **"Kalshi"** from the exchange dropdown
   - Fill in:
     - **Label:** (e.g., "Kalshi Production" or "Kalshi Demo")
     - **API Key:** Paste your **Key ID** (the UUID)
     - **API Secret:** Paste your **Private Key** (the full RSA private key including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`)
     - **Environment:** Select `production` or `demo`

3. **Save:**
   - Click **"Save"** or **"Add Credential"**

### Via Supabase SQL (Alternative)

If you prefer to add credentials directly to the database:

```sql
INSERT INTO bot_credentials (
  user_id,
  exchange,
  api_key,
  api_secret,
  environment,
  label
)
VALUES (
  'your-user-uuid-here',
  'kalshi',
  'a952bcbe-ec3b-4b5b-b8f9-11dae589608c',  -- Your Key ID
  '-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
... (full private key) ...
-----END RSA PRIVATE KEY-----',  -- Your Private Key (full PEM format)
  'production',  -- or 'demo'
  'Kalshi Production'
);
```

**Note:** The private key should be stored as a single string with newlines (`\n`) preserved.

---

## Step 3: Verify Credentials

### Test Connection

You can test your credentials using the Sparky health endpoint or by sending a test webhook:

```bash
# Test webhook (replace with your values)
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-webhook-secret",
    "exchange": "kalshi",
    "action": "BUY",
    "symbol": "KXHIGHNY-24JAN01-T60",
    "side": "YES",
    "position_size_usd": 100
  }'
```

### Check Logs

If credentials are invalid, you'll see an error in Sparky logs:
```
❌ No kalshi credentials found for user <user-id>
❌ Failed to create kalshi API for user <user-id>: Invalid RSA private key format
```

---

## Credential Storage Format

### Database Schema

The `bot_credentials` table stores:

| Field | Value | Example |
|-------|-------|---------|
| `user_id` | User UUID | `550e8400-e29b-41d4-a716-446655440000` |
| `exchange` | `'kalshi'` | `'kalshi'` |
| `api_key` | Key ID (UUID) | `'a952bcbe-ec3b-4b5b-b8f9-11dae589608c'` |
| `api_secret` | Private Key (PEM) | `'-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----'` |
| `environment` | `'production'` or `'demo'` | `'production'` |
| `label` | Friendly name | `'Kalshi Production'` |

### Private Key Format

The private key must be in **PEM format**:

```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
(multiple lines of base64-encoded key data)
...
-----END RSA PRIVATE KEY-----
```

**Important:**
- Include the BEGIN and END lines
- Preserve newlines (use `\n` in database or paste as-is in UI)
- No extra spaces or characters

---

## Security Best Practices

1. **Never commit private keys to git**
   - Private keys are stored in Supabase (encrypted at rest)
   - Never put them in `config.json` or `.env` files that are committed

2. **Use environment-specific keys**
   - Use separate keys for demo and production
   - Label them clearly in SignalStudio

3. **Rotate keys periodically**
   - Delete old keys in Kalshi dashboard
   - Generate new keys and update in SignalStudio

4. **Limit key permissions**
   - Kalshi API keys have scopes (read/write)
   - Use minimal required permissions

5. **Monitor key usage**
   - Check Kalshi dashboard for API key activity
   - Review Sparky logs for authentication errors

---

## Troubleshooting

### "Invalid RSA private key format"

**Cause:** Private key is malformed or missing BEGIN/END lines.

**Fix:**
- Ensure the full private key is copied (including BEGIN and END lines)
- Check for extra spaces or characters
- Verify newlines are preserved

### "No kalshi credentials found for user"

**Cause:** Credentials not added to SignalStudio or wrong user_id.

**Fix:**
- Verify credentials exist in `bot_credentials` table for your user_id
- Check that `exchange = 'kalshi'` and `environment = 'production'` (or 'demo')
- Ensure user_id in webhook matches the credential's user_id

### "RSA-PSS signing failed"

**Cause:** Private key doesn't match the Key ID or is corrupted.

**Fix:**
- Verify Key ID matches the private key
- Regenerate API key in Kalshi if needed
- Update credentials in SignalStudio

### "401 Unauthorized"

**Cause:** Invalid signature or expired timestamp.

**Fix:**
- Check system clock is synchronized
- Verify Key ID and Private Key are correct
- Ensure credentials are for the correct environment (production vs demo)

---

## Demo vs Production

### Demo Environment

- **URL:** `https://demo-api.kalshi.com/trade-api/v2`
- **Account:** Separate demo account required
- **Use Case:** Testing and development
- **Credentials:** Generate separate API keys in demo account

### Production Environment

- **URL:** `https://api.kalshi.com/trade-api/v2`
- **Account:** Your real Kalshi account
- **Use Case:** Live trading
- **Credentials:** Generate API keys in production account

**Important:** Demo and production credentials are **NOT shared**. You need separate API keys for each environment.

---

## Next Steps

Once credentials are saved:

1. ✅ Test with a small webhook
2. ✅ Verify positions are tracked correctly
3. ✅ Check that orders execute properly
4. ✅ Monitor logs for any errors

For detailed API documentation, see [`docs/reference/KALSHI_IMPLEMENTATION.md`](../reference/KALSHI_IMPLEMENTATION.md).

---

**Last Updated:** December 2025

