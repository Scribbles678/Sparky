# Sparky Bot API Reference

Complete reference for all Sparky Bot API endpoints.

---

## Base URL

**Production:** `https://your-sparky-bot-url.com`  
**Development:** `http://localhost:3000`

---

## Authentication

Most endpoints require webhook secret validation. The webhook secret is validated per-user from Supabase `bot_credentials` table.

**For direct webhooks (legacy):**
- Include `secret` field in request body
- Secret must match user's webhook secret in Supabase

**For SignalStudio orders:**
- Include `user_id` and `secret` in request body
- SignalStudio pre-validates, Sparky Bot trusts the order

---

## Webhook Endpoints

### POST /webhook

Main webhook endpoint for receiving trading alerts from TradingView or SignalStudio.

**Rate Limit:** 30 requests per minute

**Request Body:**
```json
{
  "secret": "your-webhook-secret",
  "user_id": "user-uuid",
  "exchange": "aster",
  "action": "BUY",
  "symbol": "BTCUSDT",
  "order_type": "market",
  "position_size_usd": 100,
  "stop_loss_percent": 2.0,
  "take_profit_percent": 4.0,
  "strategy_id": "strategy-uuid",
  "strategy": "My Strategy"
}
```

**Required Fields:**
- `secret` - Webhook secret (per-user from Supabase)
- `exchange` - Exchange name (aster, oanda, tradier, etc.)
- `action` - Trade action (BUY, SELL, CLOSE)
- `symbol` - Trading symbol (BTCUSDT, EUR_USD, etc.)

**Optional Fields:**
- `user_id` - User UUID (from SignalStudio)
- `order_type` - Order type (market, limit) - defaults to market
- `position_size_usd` - Position size in USD
- `stop_loss_percent` - Stop loss percentage
- `take_profit_percent` - Take profit percentage
- `strategy_id` - Strategy UUID (for tracking)
- `strategy` - Strategy name (for logging)
- `price` - Limit price (required for LIMIT orders)

**Response (Success):**
```json
{
  "success": true,
  "duration": "234ms",
  "action": "opened",
  "symbol": "BTCUSDT",
  "exchange": "aster",
  "quantity": 0.00105,
  "entryPrice": 95000,
  "orderId": "12345",
  "message": "Position opened successfully"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Error message",
  "duration": "123ms"
}
```

**Error Codes:**
- `400` - Bad Request (missing/invalid fields)
- `401` - Unauthorized (invalid webhook secret)
- `429` - Too Many Requests (webhook limit or risk limit exceeded)
- `500` - Internal Server Error

**Special Response Codes:**
- `200` with `success: false` and `blocked_by_ml: true` - Trade blocked by ML validation (not an error, but trade was prevented)

**ML Validation (Optional):**
If the webhook includes a `strategy_id` and the strategy has `ml_assistance_enabled = true`, the trade will be validated by Arthur ML service before execution:

- ML validation checks signal confidence against configured threshold
- Trades with confidence below threshold are blocked
- Blocked trades return a special response (see below)
- ML service errors result in fail-open behavior (trade proceeds)

**Response (ML Blocked):**
```json
{
  "success": false,
  "blocked_by_ml": true,
  "confidence": 45,
  "threshold": 70,
  "reasons": ["low_volume", "weak_support"],
  "message": "Trade blocked by ML validation (confidence 45% < 70%)"
}
```

**Notes:**
- Webhook secret is validated per-user from Supabase (cached)
- Subscription limits are checked (monthly webhook quotas)
- Risk limits are checked (weekly trade/loss limits)
- ML validation is checked (if enabled on strategy)
- User credentials are loaded dynamically from Supabase

---

## Health & Status Endpoints

### GET /health

Health check endpoint. Returns bot status, uptime, and current positions.

**Response:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "uptimeFormatted": "1h 0m",
  "apiStatus": "connected",
  "balance": 1250.50,
  "openPositions": 2,
  "positions": [
    {
      "symbol": "BTCUSDT",
      "side": "BUY",
      "quantity": 0.001,
      "entryPrice": 95000
    }
  ],
  "timestamp": "2025-01-15T12:00:00.000Z"
}
```

**Status Values:**
- `ok` - Bot is running normally
- `starting` - Bot is still initializing
- `error` - Bot encountered an error

---

### GET /health/ai-worker

AI Worker health check. Returns active AI strategy count.

**Response:**
```json
{
  "status": "ok",
  "activeStrategies": 3,
  "timestamp": "2025-01-15T12:00:00.000Z"
}
```

**Note:** This endpoint checks if AI strategies are running. The AI worker itself runs as a separate PM2 process.

---

## Position Endpoints

### GET /positions

Get all currently tracked open positions.

**Response:**
```json
{
  "totalPositions": 2,
  "longPositions": 1,
  "shortPositions": 1,
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "positions": [
    {
      "symbol": "BTCUSDT",
      "side": "BUY",
      "quantity": 0.001,
      "entryPrice": 95000,
      "timestamp": "2025-01-15T10:00:00.000Z"
    }
  ]
}
```

**Note:** Positions are automatically synced with exchange every 5 minutes via PositionUpdater service.

---

## Strategy Management API

### GET /api/strategies

Get all strategies with analytics.

**Response:**
```json
{
  "success": true,
  "strategies": [
    {
      "name": "My Strategy",
      "description": "Strategy description",
      "asset_class": "crypto",
      "status": "active",
      "success_rate": 65.5,
      "avg_profit": 12.50,
      "total_trades": 100,
      "winning_trades": 65,
      "losing_trades": 35,
      "risk_level": "balanced",
      "created_at": "2025-01-01T00:00:00.000Z",
      "updated_at": "2025-01-15T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

---

### GET /api/strategies/comparison

Get strategy performance comparison (ranked by success rate).

**Response:**
```json
{
  "success": true,
  "comparison": [
    {
      "name": "Best Strategy",
      "success_rate": 75.0,
      "avg_profit": 15.00,
      "total_trades": 50,
      "risk_level": "balanced",
      "asset_class": "crypto",
      "rank": 1,
      "performance_score": 52.5
    }
  ],
  "best_strategy": "Best Strategy",
  "worst_strategy": "Worst Strategy"
}
```

---

### GET /api/strategies/:strategyName

Get specific strategy details.

**Parameters:**
- `strategyName` - Strategy name (URL parameter)

**Response:**
```json
{
  "success": true,
  "strategy": {
    "name": "My Strategy",
    "description": "Strategy description",
    "asset_class": "crypto",
    "status": "active",
    "success_rate": 65.5,
    "avg_profit": 12.50,
    "total_trades": 100,
    "winning_trades": 65,
    "losing_trades": 35,
    "risk_level": "balanced",
    "created_at": "2025-01-01T00:00:00.000Z",
    "updated_at": "2025-01-15T12:00:00.000Z"
  }
}
```

**Error Response (404):**
```json
{
  "error": "Strategy not found"
}
```

---

### GET /api/strategies/:strategyName/performance

Get strategy performance over time.

**Parameters:**
- `strategyName` - Strategy name (URL parameter)
- `days` - Number of days (query parameter, default: 30)

**Response:**
```json
{
  "success": true,
  "strategy": {
    "name": "My Strategy",
    "success_rate": 65.5,
    "avg_profit": 12.50,
    "total_trades": 100
  },
  "performance_period": "30 days",
  "message": "Historical performance data would be implemented here"
}
```

**Note:** Historical performance data is a placeholder for future implementation.

---

### POST /api/strategies

Create a new strategy.

**Request Body:**
```json
{
  "name": "My New Strategy",
  "description": "Strategy description",
  "assetClass": "crypto",
  "status": "active",
  "pineScript": "// Pine Script code",
  "successRate": 0,
  "avgProfit": 0,
  "riskLevel": "balanced",
  "maxPositionSize": 1000,
  "stopLossPercent": 2.0,
  "takeProfitPercent": 4.0,
  "timeframe": "1h",
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "webhookSecret": "secret",
  "notes": "Strategy notes"
}
```

**Response (201):**
```json
{
  "success": true,
  "strategy": {
    "id": "uuid",
    "name": "My New Strategy",
    ...
  },
  "message": "Strategy created successfully"
}
```

**Error Response (400):**
```json
{
  "error": "Error message"
}
```

---

### POST /api/strategies/reload

Reload strategies from database. Useful when strategy status changes in SignalStudio.

**Response:**
```json
{
  "success": true,
  "message": "Strategies reloaded successfully",
  "activeCount": 5
}
```

**Note:** This endpoint allows external systems (like SignalStudio) to trigger a strategy reload when strategy status is changed.

---

## Error Responses

All endpoints may return the following error formats:

**400 Bad Request:**
```json
{
  "success": false,
  "error": "Missing required field: action"
}
```

**401 Unauthorized:**
```json
{
  "success": false,
  "error": "Unauthorized: Invalid webhook secret"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": "Not found"
}
```

**429 Too Many Requests:**
```json
{
  "success": false,
  "error": "Webhook limit exceeded",
  "message": "Monthly webhook limit exceeded: 5/5",
  "data": {
    "current": 5,
    "limit": 5,
    "plan": "Free",
    "resetDate": "2025-02-01T00:00:00.000Z"
  }
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Internal server error"
}
```

---

## Rate Limiting

- **Webhook Endpoint:** 30 requests per minute per IP
- **Other Endpoints:** No rate limiting (internal use)

---

## CORS

CORS is enabled for dashboard access:
- Allowed origins: `http://localhost:3001`, `http://127.0.0.1:3001`, `DASHBOARD_URL` env variable
- Allowed methods: GET, POST, OPTIONS
- Allowed headers: Content-Type, Authorization

---

## Notes

- All timestamps are in ISO 8601 format (UTC)
- All monetary values are in USD
- Position sizes are in base currency (e.g., BTC, ETH)
- Percentages are decimal values (e.g., 2.0 = 2%)

---

**Version:** 1.0  
**Last Updated:** January 2025

