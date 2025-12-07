# Phase 1 Quick Start Guide

**Goal**: Get multi-user authentication working in 2-3 weeks

---

## 🎯 What You're Building

1. **User Registration & Login** - Users create accounts
2. **Per-User Webhook Secrets** - Each user gets unique secret
3. **Data Isolation** - Users only see their own trades/positions
4. **Per-User Rate Limiting** - Each user has their own limit

---

## 📦 Step 1: Install Dependencies (5 min)

```bash
npm install bcrypt jsonwebtoken express-session cookie-parser
```

---

## 🗄️ Step 2: Run Database Migration (10 min)

1. Open Supabase SQL Editor
2. Run `docs/schema/phase1-users.sql`
3. Verify tables created: `users`, `user_sessions`

---

## 🔧 Step 3: Add Environment Variables (2 min)

Add to `.env`:
```env
JWT_SECRET=your_super_secret_jwt_key_min_32_characters_long
SESSION_SECRET=your_session_secret_here
BCRYPT_ROUNDS=10
```

---

## 📝 Step 4: Create New Files (2-3 days)

### **Priority Order:**

1. **`src/services/userService.js`** (Day 1)
   - `createUser(email, password, name)`
   - `getUserByEmail(email)`
   - `getUserByWebhookSecret(secret)`
   - `validatePassword(user, password)`
   - `generateWebhookSecret()`

2. **`src/middleware/auth.js`** (Day 1)
   - `requireAuth(req, res, next)` - Protect routes
   - `getUserFromToken(token)` - Validate JWT
   - `getUserFromWebhookSecret(secret)` - For webhooks

3. **`src/api/auth.js`** (Day 2)
   - `POST /api/auth/register`
   - `POST /api/auth/login`
   - `POST /api/auth/logout`
   - `GET /api/auth/me`

4. **`src/api/users.js`** (Day 2)
   - `GET /api/users/profile`
   - `GET /api/users/webhook-secret`

---

## 🔨 Step 5: Modify Existing Files (2-3 days)

### **`src/index.js`** (Critical - Day 3)

**Changes:**
1. Import auth middleware and routes
2. Replace webhook secret check with user lookup
3. Change rate limiter to per-user
4. Attach user to request object

**Key Code:**
```javascript
// Add imports
const userService = require('./services/userService');
const authRoutes = require('./api/auth');

// Replace webhook validation
const user = await userService.getUserByWebhookSecret(alertData.secret);
if (!user || !user.is_active) {
  return res.status(401).json({ error: 'Invalid secret' });
}
req.user = user;
```

### **`src/tradeExecutor.js`** (Day 4)

**Changes:**
1. Accept `userId` parameter
2. Pass `userId` to position tracker
3. Include `user_id` in Supabase saves

### **`src/positionTracker.js`** (Day 4)

**Changes:**
1. Include `userId` in position keys
2. Update all methods to accept `userId`

### **`src/supabaseClient.js`** (Day 5)

**Changes:**
1. Add `user_id` to `savePosition()`
2. Add `user_id` to `logTrade()`
3. Add user service functions

---

## ✅ Step 6: Testing Checklist

### **Basic Flow:**
- [ ] User can register: `POST /api/auth/register`
- [ ] User can login: `POST /api/auth/login`
- [ ] User gets webhook secret: `GET /api/users/webhook-secret`
- [ ] Webhook works with user secret
- [ ] Trades saved with correct `user_id`
- [ ] User A can't see User B's data

### **Test Commands:**
```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","name":"Test User"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# Get webhook secret (use token from login)
curl -X GET http://localhost:3000/api/users/webhook-secret \
  -H "Authorization: Bearer YOUR_TOKEN"

# Test webhook
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"secret":"USER_WEBHOOK_SECRET","exchange":"aster","action":"buy","symbol":"BTCUSDT"}'
```

---

## 🚨 Common Issues & Fixes

### **Issue: "Invalid webhook secret"**
- **Fix**: Check user is active: `is_active = true`
- **Fix**: Verify secret matches exactly (no spaces)

### **Issue: "User not found"**
- **Fix**: Check `getUserByWebhookSecret()` query
- **Fix**: Verify Supabase connection

### **Issue: "Rate limit exceeded"**
- **Fix**: Check per-user rate limit is working
- **Fix**: Verify `req.user.id` is set correctly

### **Issue: "Trades not isolated"**
- **Fix**: Verify `user_id` added to all Supabase inserts
- **Fix**: Check RLS policies are correct

---

## 📊 Progress Tracking

### **Week 1: Foundation**
- [ ] Day 1: Database schema + dependencies
- [ ] Day 2: User service + auth middleware
- [ ] Day 3: Auth routes (register/login)
- [ ] Day 4: Webhook integration
- [ ] Day 5: Testing

### **Week 2: Integration**
- [ ] Day 6: Position tracker updates
- [ ] Day 7: Trade executor updates
- [ ] Day 8: Supabase client updates
- [ ] Day 9: User routes
- [ ] Day 10: End-to-end testing

---

## 🎓 Key Concepts

### **Webhook Secret Flow:**
```
1. User registers → Gets unique webhook_secret
2. User configures TradingView → Uses their secret
3. TradingView sends webhook → Bot looks up user by secret
4. Bot executes trade → Saves with user_id
```

### **Authentication Flow:**
```
1. User registers → Password hashed with bcrypt
2. User logs in → Gets JWT token
3. User makes API call → Token validated
4. User data returned → Filtered by user_id
```

### **Data Isolation:**
```
- All queries include: WHERE user_id = ?
- Position keys: `${userId}:${exchange}:${symbol}`
- RLS policies enforce user separation
```

---

## 📚 Reference Files

- **Full Implementation Plan**: `docs/PHASE1_IMPLEMENTATION.md`
- **Database Schema**: `docs/schema/phase1-users.sql`
- **Current Architecture**: `docs/PROJECT_STRUCTURE.md`

---

## 🆘 Need Help?

**Common Questions:**
1. **"How do I test without frontend?"** → Use curl/Postman
2. **"What if user forgets webhook secret?"** → Add regenerate endpoint
3. **"How to migrate existing data?"** → See migration script in full plan
4. **"What about password reset?"** → Phase 2 feature

---

**Estimated Time**: 2-3 weeks  
**Difficulty**: Medium  
**Dependencies**: Supabase, Node.js 18+

**Ready to start?** Begin with Step 1! 🚀

