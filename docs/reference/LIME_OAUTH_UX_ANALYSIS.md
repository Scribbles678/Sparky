# Lime OAuth 2.0 User Experience Analysis

## Overview

Lime Trading offers two OAuth 2.0 flows with different user experiences. This document analyzes the UX implications of each flow and recommends the best approach for SignalStudio integration.

---

## Flow Comparison

### Option 1: Password Flow (Resource Owner Password Credentials)

**User Experience:** ⚠️ **Moderate** - Similar to Capital.com (session-based)

#### Initial Setup (One-Time)

**Step 1: User Registration (One-Time)**
- User must register application at https://myaccount.lime.co
- Receives `client_id` and `client_secret`
- **User Action:** Copy/paste these into SignalStudio

**Step 2: Add Credentials in SignalStudio**
- User navigates to Account → Exchanges
- Selects "Lime Trading"
- Fills in form:
  - **Client ID:** (from Lime portal)
  - **Client Secret:** (from Lime portal)
  - **Username:** (Lime account username)
  - **Password:** (Lime account password)
  - **Account Number:** (optional - auto-detected if not provided)
- Clicks "Save"

**Step 3: System Behavior (Behind the Scenes)**
- System exchanges username/password for access token
- Token stored securely (encrypted in database)
- Token expiration time calculated (3:00 AM ET next day)
- Account number auto-detected from `/accounts` endpoint

#### Daily Usage Experience

**Token Refresh (Automatic - User Doesn't See This)**
- System checks token expiration before each API call
- If token expires within 1 hour, system automatically refreshes
- Refresh happens in background (user doesn't notice)
- **User Experience:** Seamless - no interruption

**If Token Expires (Edge Case)**
- Token expires at 3:00 AM ET daily
- If system tries to use expired token:
  - API returns 401 Unauthorized
  - System automatically refreshes token
  - Retries request
  - **User Experience:** Slight delay (1-2 seconds), but automatic recovery

**Token Refresh Process:**
```
1. System detects token expires soon (before 3 AM ET)
2. System calls: POST /connect/token with username/password
3. New token received and stored
4. API calls continue normally
```

**User Experience:** ✅ **Good** - Fully automatic, user never sees token management

#### Ongoing Maintenance

**Password Changes:**
- If user changes Lime password:
  - Next token refresh will fail (401 error)
  - System detects failure
  - User must update password in SignalStudio
  - **User Experience:** ⚠️ One-time update needed

**Account Access:**
- User can revoke access in Lime portal
- System will get 401 errors
- User must re-authenticate
- **User Experience:** ⚠️ Occasional re-auth needed

---

### Option 2: Authorization Code Flow (Standard OAuth)

**User Experience:** ⚠️ **More Complex** - Similar to E*TRADE (but better)

#### Initial Setup (One-Time)

**Step 1: Application Registration (Admin/One-Time)**
- We register SignalStudio as an OAuth application with Lime
- Receive `client_id` and `client_secret`
- Add callback URLs to whitelist: `https://signalstudio.com/auth/lime/callback`
- **User Action:** None (we handle this)

**Step 2: User Authorization (Per User)**
- User navigates to Account → Exchanges in SignalStudio
- Selects "Lime Trading"
- Clicks "Connect Lime Account" button
- **User is redirected to Lime login page:**
  - `https://auth.lime.co/connect/authorize?response_type=code&client_id={our_client_id}&redirect_uri={callback_url}`
- User logs in with Lime credentials
- User sees authorization screen: "SignalStudio wants to access your Lime account"
- User clicks "Authorize"
- **User is redirected back to SignalStudio:**
  - `https://signalstudio.com/auth/lime/callback?code={authorization_code}`
- SignalStudio exchanges code for access token (behind the scenes)
- Token stored securely
- **User Experience:** ⚠️ **2-3 clicks, browser redirect** - More steps than password flow

**Step 3: Account Selection (If Multiple Accounts)**
- System fetches user's accounts from `/accounts` endpoint
- If multiple accounts, user selects default account
- Account number stored in credentials
- **User Experience:** One-time selection

#### Daily Usage Experience

**Token Auto-Extension (Automatic)**
- Token valid for 24 hours
- **Auto-extended with each API call** (nice feature!)
- As long as user trades at least once per 24 hours, token never expires
- **User Experience:** ✅ **Excellent** - Token essentially never expires if active

**If Token Expires (Rare)**
- Only happens if user doesn't trade for 24+ hours
- System gets 401 error
- System redirects user to re-authorize
- **User Experience:** ⚠️ Occasional re-auth (only if inactive for 24+ hours)

**Token Refresh Process:**
```
1. User makes API call
2. System includes token in request
3. Lime auto-extends token expiration (24 hours from now)
4. Token essentially never expires if user is active
```

**User Experience:** ✅ **Excellent** - Token auto-extends, minimal re-auth needed

#### Ongoing Maintenance

**Re-Authorization:**
- Only needed if:
  - User doesn't trade for 24+ hours (token expires)
  - User revokes access in Lime portal
- **User Experience:** ⚠️ Occasional re-auth (less frequent than password flow)

---

## UX Comparison Table

| Aspect | Password Flow | Authorization Code Flow |
|--------|--------------|------------------------|
| **Initial Setup** | ⚠️ Moderate (4 fields) | ⚠️ More Complex (browser redirect) |
| **User Sees Password** | ✅ Yes (enters directly) | ✅ No (enters on Lime site) |
| **Token Expiration** | ⚠️ Daily at 3 AM ET | ✅ 24 hours (auto-extends) |
| **Token Refresh** | ⚠️ Must refresh daily | ✅ Auto-extends with usage |
| **Re-Auth Frequency** | ⚠️ If password changes | ⚠️ If inactive 24+ hours |
| **Security** | ⚠️ Password stored (encrypted) | ✅ Password never stored |
| **User Control** | ⚠️ Less (can't revoke easily) | ✅ More (can revoke in Lime portal) |
| **Best For** | Direct users | Third-party apps |

---

## Recommended Implementation: Password Flow

### Why Password Flow is Better for SignalStudio

1. **Simpler Initial Setup:**
   - User enters credentials directly in SignalStudio
   - No browser redirects
   - No callback URL management
   - Similar to Capital.com (users already familiar)

2. **Better for Automated Trading:**
   - Token refresh is predictable (3 AM ET)
   - Can proactively refresh before expiration
   - No dependency on user being active

3. **User Familiarity:**
   - Users already enter API keys/secrets
   - Adding username/password is natural extension
   - No OAuth redirect confusion

4. **Implementation Simplicity:**
   - No callback URL handling
   - No OAuth state management
   - Simpler credential storage

### Implementation Strategy

**Credential Storage:**
```typescript
// In SignalStudio exchange form
{
  client_id: string,      // From Lime portal
  client_secret: string,   // From Lime portal
  username: string,        // Lime account username
  password: string,        // Lime account password (encrypted)
  account_number?: string  // Optional - auto-detected
}
```

**Token Management (Behind the Scenes):**
```javascript
// In limeApi.js
class LimeAPI {
  constructor(clientId, clientSecret, username, password, accountNumber) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.username = username;
    this.password = password;
    this.accountNumber = accountNumber;
    this.accessToken = null;
    this.tokenExpiresAt = null;
  }

  async ensureValidToken() {
    const now = Date.now();
    const threeAMET = this.getNext3AMET(); // Calculate next 3 AM ET
    
    // Refresh if expires within 1 hour
    if (!this.accessToken || now >= (threeAMET - 3600000)) {
      await this.refreshToken();
    }
  }

  async refreshToken() {
    const response = await axios.post('https://auth.lime.co/connect/token', {
      grant_type: 'password',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      username: this.username,
      password: this.password,
    }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    this.accessToken = response.data.access_token;
    this.tokenExpiresAt = this.getNext3AMET();
    
    // Store token in Redis (encrypted) for this user
    await redis.set(`lime:token:${this.userId}`, this.accessToken, 'EX', 28800);
  }
}
```

**User Experience Flow:**
1. User adds credentials in SignalStudio (one-time)
2. System automatically gets token (behind the scenes)
3. System automatically refreshes token daily (before 3 AM ET)
4. User never sees token management
5. If password changes, user updates in SignalStudio (one-time)

---

## Alternative: Authorization Code Flow (If Required)

### When to Use Authorization Code Flow

- **If Lime requires it** for third-party applications
- **If security policy** requires password never be stored
- **If user preference** for OAuth-style authorization

### Implementation Strategy

**SignalStudio Integration:**
```typescript
// In SignalStudio exchange form
{
  client_id: string,        // Our app's client_id (shared)
  client_secret: string,    // Our app's client_secret (shared, server-side only)
  // No username/password stored
  // User authorizes via browser redirect
}
```

**OAuth Flow:**
1. User clicks "Connect Lime Account" in SignalStudio
2. SignalStudio redirects to: `https://auth.lime.co/connect/authorize?...`
3. User logs in and authorizes on Lime site
4. Lime redirects back: `https://signalstudio.com/auth/lime/callback?code={code}`
5. SignalStudio server exchanges code for token
6. Token stored securely
7. User redirected back to exchange accounts page

**Token Management:**
- Token auto-extends with each API call
- Only expires if user inactive for 24+ hours
- User can revoke in Lime portal

**User Experience:**
- ⚠️ More complex initial setup (browser redirect)
- ✅ Better ongoing experience (token auto-extends)
- ✅ Better security (password never stored)

---

## Comparison to Other Exchanges

### Similar to Capital.com (Session-Based)
- **Capital.com:** Session tokens expire after 10 minutes
- **Lime (Password):** Token expires at 3 AM ET daily
- **User Experience:** Both require automatic refresh, but Lime is less frequent

### Similar to E*TRADE (OAuth, but Better)
- **E*TRADE:** OAuth 1.0, expires daily at midnight
- **Lime (Password):** OAuth 2.0, expires at 3 AM ET
- **User Experience:** Similar expiration, but Lime is simpler (OAuth 2.0 vs OAuth 1.0)

### Better than Robinhood (Ed25519)
- **Robinhood:** Requires Ed25519 key pair generation
- **Lime:** Standard OAuth 2.0
- **User Experience:** Lime is simpler (standard OAuth vs custom signing)

---

## Recommended User Experience

### Password Flow Implementation

**Initial Setup (SignalStudio UI):**
```
┌─────────────────────────────────────────┐
│ Add Lime Trading Account                │
├─────────────────────────────────────────┤
│                                         │
│ Client ID: [________________]           │
│ (Get from https://myaccount.lime.co)    │
│                                         │
│ Client Secret: [________________]        │
│                                         │
│ Username: [________________]            │
│ (Your Lime account username)            │
│                                         │
│ Password: [________________]            │
│ (Your Lime account password)            │
│                                         │
│ Account Number: [Auto-detected]         │
│ (Optional - will be auto-detected)     │
│                                         │
│ [Cancel]  [Save & Connect]             │
└─────────────────────────────────────────┘
```

**Behind the Scenes:**
1. User clicks "Save & Connect"
2. System calls Lime OAuth endpoint with credentials
3. Receives access token
4. Fetches account list to get account number
5. Stores everything securely (password encrypted)
6. Shows success message: "Lime account connected successfully"

**Daily Usage:**
- User trades normally
- System automatically refreshes token before 3 AM ET
- User never sees token management
- **User Experience:** Seamless, no interruptions

**If Password Changes:**
- User updates password in SignalStudio
- System automatically gets new token
- **User Experience:** One-time update, seamless

---

## Security Considerations

### Password Flow Security

**Stored Data:**
- Client ID: Not sensitive (public)
- Client Secret: Sensitive (encrypted)
- Username: Not sensitive
- Password: **Highly sensitive** (must be encrypted at rest)

**Encryption:**
- Password encrypted in database (AES-256)
- Token encrypted in Redis cache
- Never log passwords or tokens

**Access Control:**
- Only user can see their own credentials
- Admin cannot see passwords (encrypted)
- Token refresh uses stored credentials (no user interaction)

### Authorization Code Flow Security

**Stored Data:**
- Client ID: Not sensitive (shared app ID)
- Client Secret: Sensitive (server-side only, never exposed)
- Access Token: Sensitive (encrypted)
- **No password stored** ✅

**Access Control:**
- User can revoke access in Lime portal
- Token can be revoked without password change
- Better security model (password never stored)

---

## Final Recommendation

### Use Password Flow for SignalStudio

**Reasons:**
1. ✅ Simpler user experience (direct credential entry)
2. ✅ Predictable token expiration (3 AM ET)
3. ✅ Automatic refresh (user never sees it)
4. ✅ Similar to Capital.com (users familiar)
5. ✅ Better for automated trading (no dependency on user activity)

**Implementation:**
- Store credentials securely (password encrypted)
- Implement proactive token refresh (before 3 AM ET)
- Handle 401 errors gracefully (auto-refresh on failure)
- Provide clear error messages if password changes

**User Experience Rating:** ⭐⭐⭐⭐ (4/5)
- Simple initial setup
- Seamless daily usage
- Occasional password update if changed

---

## Alternative: Authorization Code Flow (If Required)

**Use if:**
- Lime requires it for third-party apps
- Security policy requires password never be stored
- User preference for OAuth-style flow

**User Experience Rating:** ⭐⭐⭐ (3/5)
- More complex initial setup (browser redirect)
- Better ongoing experience (token auto-extends)
- Better security (password never stored)

---

## Conclusion

**Password Flow is recommended** for SignalStudio because:
- Simpler user experience
- Predictable token management
- Better for automated trading
- Users already familiar with credential entry

**User Experience:** Good - Similar to Capital.com, with automatic token refresh that users never see.
