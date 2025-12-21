# TradeStation OAuth 2.0 Setup Guide

## Overview

This guide explains how to set up TradeStation OAuth 2.0 Authorization Code Flow in SignalStudio.

## Prerequisites

1. **TradeStation Account**: User must have a TradeStation account
2. **API Key Registration**: SignalStudio must be registered as an OAuth application with TradeStation Client Experience
3. **Runtime Configuration**: OAuth credentials must be configured in SignalStudio

## Step 1: Register SignalStudio with TradeStation (Admin)

**Contact TradeStation Client Experience** to:
1. Register SignalStudio as an OAuth application
2. Receive `client_id` (API Key) and `client_secret`
3. Configure callback URLs:
   - Production: `https://yourdomain.com/api/auth/tradestation/callback`
   - Development: `http://localhost:3000/api/auth/tradestation/callback`
4. Configure scopes: `openid profile offline_access MarketData ReadAccount Trade OptionSpreads Matrix`

**Note:** Default API Keys are configured for localhost development:
- `http://localhost`
- `http://localhost:3000`
- `http://localhost:8080`
- etc.

## Step 2: Configure SignalStudio Runtime Config

Add OAuth credentials to SignalStudio's runtime configuration:

### Option 1: Environment Variables (Recommended)

Create or update `.env` file:
```bash
TRADESTATION_CLIENT_ID=your_client_id_here
TRADESTATION_CLIENT_SECRET=your_client_secret_here
```

### Option 2: Nuxt Config

Update `nuxt.config.ts`:
```typescript
export default defineNuxtConfig({
  runtimeConfig: {
    // Private (server-side only)
    tradestationClientSecret: process.env.TRADESTATION_CLIENT_SECRET,
    
    // Public (can be exposed to client)
    public: {
      tradestationClientId: process.env.TRADESTATION_CLIENT_ID,
    }
  }
})
```

## Step 3: User Authorization Flow

### Frontend Implementation

In SignalStudio's exchange accounts page, add a "Connect TradeStation Account" button:

```vue
<template>
  <button @click="connectTradeStation">
    Connect TradeStation Account
  </button>
</template>

<script setup>
const connectTradeStation = () => {
  // Redirect to authorization endpoint
  window.location.href = '/api/auth/tradestation/authorize'
}
</script>
```

### OAuth Flow Steps

1. **User clicks "Connect TradeStation Account"**
   - Frontend redirects to: `/api/auth/tradestation/authorize`
   - System generates state parameter (CSRF protection)
   - System redirects user to TradeStation authorization page

2. **User authorizes on TradeStation**
   - User logs in with TradeStation credentials
   - User sees consent dialog
   - User clicks "Authorize"

3. **TradeStation redirects back**
   - TradeStation redirects to: `/api/auth/tradestation/callback?code={auth_code}&state={state}`
   - System validates state parameter
   - System exchanges authorization code for tokens

4. **System stores credentials**
   - System exchanges code for access token and refresh token
   - System fetches account ID from TradeStation
   - System stores credentials in `bot_credentials` table:
     - `api_key`: Client ID
     - `api_secret`: Client Secret (encrypted)
     - `extra_metadata.refreshToken`: Refresh token
     - `extra_metadata.accountId`: Account ID (auto-detected)

5. **User redirected to success page**
   - System redirects to: `/account/exchange-accounts?success=TradeStation account connected successfully`

## API Endpoints

### Authorization Endpoint

**URL:** `/api/auth/tradestation/authorize`

**Method:** GET

**Query Parameters:**
- `environment` (optional): `production` or `sim` (default: `production`)
- `redirectPath` (optional): Path to redirect after success (default: `/account/exchange-accounts`)

**Response:** Redirects to TradeStation authorization page

**Example:**
```
GET /api/auth/tradestation/authorize?environment=production
```

### Callback Endpoint

**URL:** `/api/auth/tradestation/callback`

**Method:** GET

**Query Parameters (from TradeStation):**
- `code`: Authorization code
- `state`: State parameter (for CSRF protection)
- `error` (optional): Error code if authorization failed
- `error_description` (optional): Error description

**Response:** Redirects to exchange accounts page with success/error message

**Example:**
```
GET /api/auth/tradestation/callback?code=abc123&state=xyz789
```

## Error Handling

### Common Errors

**Missing authorization code:**
- Error: `Missing authorization code`
- Cause: TradeStation didn't return authorization code
- Solution: User must complete authorization on TradeStation

**Invalid state parameter:**
- Error: `Invalid state parameter`
- Cause: State parameter doesn't match or is malformed
- Solution: User should try again

**Token exchange failed:**
- Error: `Failed to exchange authorization code`
- Cause: Invalid authorization code or credentials
- Solution: Check OAuth credentials configuration

**User authentication failed:**
- Error: `User authentication failed`
- Cause: User session expired or invalid
- Solution: User must log in again

## Security Considerations

1. **State Parameter**: Used for CSRF protection, includes user ID and timestamp
2. **Client Secret**: Stored server-side only, never exposed to client
3. **Refresh Token**: Stored encrypted in database
4. **Access Token**: Cached temporarily, expires after 20 minutes

## Testing

### Local Development

1. Ensure callback URL is configured for localhost in TradeStation
2. Start SignalStudio: `npm run dev`
3. Navigate to exchange accounts page
4. Click "Connect TradeStation Account"
5. Complete authorization flow
6. Verify credentials stored in database

### Production

1. Ensure callback URL is configured for production domain
2. Set environment variables in production environment
3. Test OAuth flow with real TradeStation account
4. Verify tokens are stored and refreshed correctly

## Troubleshooting

### Authorization fails

- Check callback URL matches TradeStation configuration
- Verify client ID and secret are correct
- Check scopes are properly configured

### Token exchange fails

- Verify authorization code is valid (not expired)
- Check client secret is correct
- Ensure callback URL matches authorization request

### Account ID not detected

- Verify access token is valid
- Check user has at least one TradeStation account
- Token may need to be refreshed

## Next Steps

After successful authorization:
1. User can now use TradeStation for trading
2. System automatically manages token refresh
3. Account ID is auto-detected and stored
4. User can trade via webhooks

## References

- [TradeStation API Documentation](https://api.tradestation.com/docs)
- [OAuth 2.0 Specification](https://oauth.net/2/)
- [TradeStation Implementation Guide](../reference/TRADESTATION_IMPLEMENTATION.md)
