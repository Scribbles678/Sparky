# Phase 1 Implementation Plan: Multi-User with Authentication

**Goal**: Support 1-10 users with per-user webhook secrets and login system

**Timeline**: 2-3 weeks  
**Infrastructure**: Single $12-24/month DigitalOcean droplet

---

## ✅ Checklist: What Needs to Be Built

### **1. Database Schema** (Critical - Day 1)

#### **A. Users Table**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL, -- bcrypt hashed
  webhook_secret VARCHAR(255) UNIQUE NOT NULL, -- Auto-generated per user
  subscription_tier VARCHAR(50) DEFAULT 'free', -- 'free', 'basic', 'pro'
  rate_limit_per_min INTEGER DEFAULT 30, -- Per-user rate limit
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  
  -- Metadata
  name VARCHAR(255),
  notes TEXT
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_webhook_secret ON users(webhook_secret);
CREATE INDEX idx_users_is_active ON users(is_active);
```

#### **B. User Sessions Table** (for login)
```sql
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL, -- JWT or session token
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent TEXT
);

CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(token);
CREATE INDEX idx_sessions_expires_at ON user_sessions(expires_at);
```

#### **C. Update Existing Tables** (Add user_id)
```sql
-- Add user_id to trades table
ALTER TABLE trades ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);

-- Add user_id to positions table
ALTER TABLE positions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
DROP INDEX IF EXISTS idx_positions_symbol; -- Remove unique constraint
CREATE UNIQUE INDEX idx_positions_user_symbol ON positions(user_id, symbol); -- Unique per user

-- Add user_id to strategies table (if exists)
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_strategies_user_id ON strategies(user_id);
```

#### **D. Row Level Security (RLS) Policies**
```sql
-- Users can only see their own data
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Policy: Users see only their trades
CREATE POLICY "Users see own trades" ON trades
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users see own positions" ON positions
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can see all (for bot operations)
CREATE POLICY "Service role full access" ON trades
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON positions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**File**: `docs/schema/phase1-users.sql`

---

### **2. Dependencies to Add** (Critical - Day 1)

```bash
npm install bcrypt jsonwebtoken express-session cookie-parser
npm install --save-dev @types/bcrypt @types/jsonwebtoken
```

**Update `package.json`**:
```json
{
  "dependencies": {
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "express-session": "^1.17.3",
    "cookie-parser": "^1.4.6"
  }
}
```

---

### **3. New Files to Create**

#### **A. User Service** (`src/services/userService.js`)
- User registration
- User login (password validation)
- Generate webhook secrets
- Get user by webhook secret
- Update user profile

#### **B. Auth Middleware** (`src/middleware/auth.js`)
- JWT token validation
- Session management
- Protect routes (require login)
- Extract user from request

#### **C. Auth Routes** (`src/api/auth.js`)
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user
- `POST /api/auth/regenerate-secret` - Generate new webhook secret

#### **D. User Routes** (`src/api/users.js`)
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update profile
- `GET /api/users/webhook-secret` - Get webhook secret

---

### **4. Code Changes to Existing Files**

#### **A. `src/index.js`** (Critical Changes)

**1. Add auth middleware:**
```javascript
const authMiddleware = require('./middleware/auth');
const authRoutes = require('./api/auth');
const userRoutes = require('./api/users');

// Add routes
app.use('/api/auth', authRoutes);
app.use('/api/users', authMiddleware.requireAuth, userRoutes);
```

**2. Replace webhook secret validation:**
```javascript
// OLD:
if (!alertData.secret || alertData.secret !== WEBHOOK_SECRET) {
  return res.status(401).json({ error: 'Invalid webhook secret' });
}

// NEW:
const userService = require('./services/userService');
const user = await userService.getUserByWebhookSecret(alertData.secret);
if (!user || !user.is_active) {
  return res.status(401).json({ error: 'Invalid or inactive webhook secret' });
}
req.user = user; // Attach user to request
```

**3. Replace global rate limit with per-user:**
```javascript
// OLD:
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // Global limit
});

// NEW:
const webhookLimiter = rateLimit({
  keyGenerator: (req) => req.user?.id || req.ip, // Per user
  windowMs: 60 * 1000,
  max: (req) => req.user?.rate_limit_per_min || 30, // Per-user limit
});
```

**4. Update webhook handler:**
```javascript
app.post('/webhook', webhookLimiter, async (req, res) => {
  // User is already attached from middleware above
  const userId = req.user.id;
  
  // Pass userId to trade executor
  const result = await tradeExecutors[exchange].executeWebhook(alertData, userId);
  // ...
});
```

#### **B. `src/tradeExecutor.js`** (Critical Changes)

**1. Accept userId parameter:**
```javascript
async executeWebhook(alertData, userId) {
  // Store userId for all operations
  this.userId = userId;
  // ... rest of method
}
```

**2. Update position tracking:**
```javascript
// OLD:
this.tracker.addPosition(symbol, positionData, this.exchange);

// NEW:
this.tracker.addPosition(symbol, positionData, this.exchange, userId);
```

**3. Update Supabase saves:**
```javascript
await savePosition({
  user_id: this.userId, // Add this
  symbol,
  side,
  // ... rest
});
```

#### **C. `src/positionTracker.js`** (Critical Changes)

**1. Update position key to include userId:**
```javascript
// OLD:
const key = `${exchange}:${symbol}`;

// NEW:
addPosition(symbol, positionData, exchange = 'aster', userId) {
  const key = `${userId}:${exchange}:${symbol}`;
  // ...
}
```

**2. Update all methods to include userId:**
```javascript
getPosition(symbol, exchange = 'aster', userId) {
  const key = `${userId}:${exchange}:${symbol}`;
  // ...
}

hasPosition(symbol, exchange = 'aster', userId) {
  const key = `${userId}:${exchange}:${symbol}`;
  // ...
}
```

#### **D. `src/supabaseClient.js`** (Critical Changes)

**1. Add user_id to all functions:**
```javascript
async function savePosition(position) {
  // position.user_id is now required
  const positionData = {
    user_id: position.userId, // Add this
    symbol: position.symbol,
    // ... rest
  };
}

async function logTrade(trade) {
  const tradeData = {
    user_id: trade.userId, // Add this
    symbol: trade.symbol,
    // ... rest
  };
}
```

**2. Add user service functions:**
```javascript
async function getUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  return { data, error };
}

async function getUserByWebhookSecret(secret) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('webhook_secret', secret)
    .eq('is_active', true)
    .single();
  return { data, error };
}

async function createUser(userData) {
  // Generate webhook secret
  const webhookSecret = crypto.randomBytes(32).toString('hex');
  
  const { data, error } = await supabase
    .from('users')
    .insert([{
      email: userData.email,
      password_hash: userData.passwordHash, // Already hashed
      webhook_secret: webhookSecret,
      subscription_tier: userData.subscriptionTier || 'free',
      rate_limit_per_min: userData.rateLimitPerMin || 30,
      name: userData.name,
    }])
    .select()
    .single();
  
  return { data, error };
}
```

---

### **5. Frontend/API Endpoints** (Optional but Recommended)

#### **A. Registration Endpoint**
```javascript
POST /api/auth/register
Body: {
  email: "user@example.com",
  password: "securepassword123",
  name: "John Doe"
}
Response: {
  user: { id, email, name },
  webhook_secret: "abc123...",
  token: "jwt_token_here"
}
```

#### **B. Login Endpoint**
```javascript
POST /api/auth/login
Body: {
  email: "user@example.com",
  password: "securepassword123"
}
Response: {
  user: { id, email, name, webhook_secret },
  token: "jwt_token_here"
}
```

#### **C. Get Webhook Secret**
```javascript
GET /api/users/webhook-secret
Headers: { Authorization: "Bearer jwt_token" }
Response: {
  webhook_secret: "abc123...",
  webhook_url: "https://your-domain.com/webhook"
}
```

---

### **6. Environment Variables** (Add to `.env`)

```env
# JWT Secret for token signing
JWT_SECRET=your_super_secret_jwt_key_here_min_32_chars

# Session secret
SESSION_SECRET=your_session_secret_here

# Password hashing rounds (bcrypt)
BCRYPT_ROUNDS=10
```

---

### **7. Migration Script** (Optional)

Create `scripts/migrate-to-multiuser.js` to:
- Create admin user from existing config
- Migrate existing trades/positions to admin user
- Generate webhook secrets for existing users

---

## 📋 Implementation Order

### **Week 1: Foundation**

**Day 1-2: Database Setup**
- [ ] Create users table
- [ ] Create user_sessions table
- [ ] Add user_id to existing tables
- [ ] Update RLS policies
- [ ] Test schema in Supabase

**Day 3-4: Authentication System**
- [ ] Install dependencies (bcrypt, jwt, etc.)
- [ ] Create `userService.js`
- [ ] Create `auth.js` middleware
- [ ] Create `auth.js` routes
- [ ] Test registration/login

**Day 5: Webhook Secret Integration**
- [ ] Update webhook handler to use per-user secrets
- [ ] Update rate limiting to per-user
- [ ] Test webhook with user secret

### **Week 2: Integration**

**Day 6-7: Position Tracking**
- [ ] Update `positionTracker.js` for multi-user
- [ ] Update `tradeExecutor.js` to accept userId
- [ ] Update all Supabase functions to include user_id
- [ ] Test position tracking isolation

**Day 8-9: User Routes & Profile**
- [ ] Create `users.js` routes
- [ ] Add profile endpoints
- [ ] Add webhook secret management
- [ ] Test user management

**Day 10: Testing & Polish**
- [ ] End-to-end testing
- [ ] Create migration script
- [ ] Update documentation
- [ ] Security audit

---

## 🔒 Security Considerations

### **Must-Have**
1. ✅ **Password Hashing**: Use bcrypt (10+ rounds)
2. ✅ **JWT Expiration**: Tokens expire after 7-30 days
3. ✅ **HTTPS Only**: All endpoints require HTTPS
4. ✅ **Rate Limiting**: Per-user rate limits
5. ✅ **Input Validation**: Sanitize all user inputs
6. ✅ **SQL Injection**: Use parameterized queries (Supabase handles this)

### **Nice-to-Have**
- Password strength requirements
- Email verification
- Two-factor authentication (Phase 2)
- IP whitelisting for webhooks
- Webhook signature verification

---

## 🧪 Testing Checklist

### **Authentication**
- [ ] User can register
- [ ] User can login
- [ ] User can logout
- [ ] Invalid credentials rejected
- [ ] JWT token validation works
- [ ] Expired tokens rejected

### **Webhook**
- [ ] Valid user secret works
- [ ] Invalid secret rejected
- [ ] Inactive user secret rejected
- [ ] Per-user rate limiting works
- [ ] Trades saved with correct user_id
- [ ] Positions isolated per user

### **Data Isolation**
- [ ] User A can't see User B's trades
- [ ] User A can't see User B's positions
- [ ] Positions tracked separately per user
- [ ] Database queries filtered by user_id

---

## 📊 Database Migration Strategy

### **Option 1: Fresh Start** (Recommended for Phase 1)
- Create new users table
- Existing trades/positions become "orphaned" (no user_id)
- New users start fresh
- **Pros**: Clean, no migration complexity
- **Cons**: Lose historical data association

### **Option 2: Migrate Existing Data**
- Create admin user
- Assign all existing trades/positions to admin
- **Pros**: Preserve history
- **Cons**: More complex migration

---

## 🚀 Deployment Checklist

### **Before Deploy**
- [ ] All database migrations run
- [ ] Environment variables set
- [ ] Dependencies installed
- [ ] Tests passing
- [ ] Documentation updated

### **After Deploy**
- [ ] Create first admin user
- [ ] Test registration flow
- [ ] Test webhook with new secret
- [ ] Monitor logs for errors
- [ ] Verify data isolation

---

## 📝 Documentation Updates Needed

1. **README.md**: Add authentication section
2. **TRADINGVIEW.md**: Update webhook secret instructions
3. **API.md** (new): Document auth endpoints
4. **DEPLOYMENT.md**: Add user setup instructions

---

## 🎯 Success Criteria

Phase 1 is complete when:
- ✅ Users can register and login
- ✅ Each user has unique webhook secret
- ✅ Webhooks work with per-user secrets
- ✅ Trades/positions isolated per user
- ✅ Per-user rate limiting works
- ✅ 1-10 users can use system simultaneously

---

## 🔄 Rollback Plan

If issues arise:
1. Keep old webhook secret validation as fallback
2. Add feature flag: `ENABLE_MULTI_USER=false`
3. Database rollback script ready
4. Old config.json still works

---

**Estimated Total Time**: 2-3 weeks  
**Estimated Lines of Code**: ~1,500-2,000  
**Files Created**: ~8 new files  
**Files Modified**: ~6 existing files

**Last Updated**: 2024

