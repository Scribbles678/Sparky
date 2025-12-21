# Sparky Trading Bot 🚀

A headless trading bot that receives TradingView webhook alerts and executes trades on multiple exchanges (Aster DEX, OANDA, Tradier, and 100+ via CCXT) with simple percentage-based stop loss and take profit.

**Part of the SignalStudio Trading Ecosystem:**
- **SignalStudio Dashboard** - Real-time analytics, strategy management, and webhook processing (`app.signal-studio.co`)
- **Sparky Bot** (this repo) - Executes trades on multiple exchanges (VPS/DigitalOcean)
- **Arthur ML Service** - Institutional-grade ML engine for AI strategies

---

## 🎯 Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/your-username/sparky-bot.git
cd sparky-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
# SUPABASE_URL=...
# SUPABASE_SERVICE_ROLE_KEY=...
# GROQ_API_KEY=... (for AI worker)
```

### Configuration

```bash
# Copy config template
cp config.json.example config.json

# Edit config.json (minimal in multi-tenant mode)
# Credentials come from SignalStudio (Supabase)
```

### Running

```bash
# Development
npm run dev

# Production (with PM2)
pm2 start ecosystem.config.js
```

---

## ✨ Features

- 🔔 **Multi-Exchange Trading** - Aster, OANDA, Tradier, 100+ via CCXT
- 🤖 **AI Signal Engine** - Institutional-grade ML with ensemble models
- 🛡️ **Risk Management** - Weekly trade/loss limits
- 📊 **Subscription Limits** - Monthly webhook quotas
- 🔐 **Multi-Tenant Architecture** - Per-user credentials
- 📈 **Real-Time Position Tracking** - Live position updates
- 🗄️ **Supabase Integration** - Analytics and data storage

---

## 📚 Documentation

**📖 [Full Documentation Index →](docs/README.md)**

### Essential Guides

- **[Deployment Guide](docs/guides/DEPLOYMENT.md)** - VPS setup and production deployment
- **[TradingView Setup](docs/guides/TRADINGVIEW.md)** - Webhook configuration
- **[AI Worker Guide](docs/guides/AI_WORKER.md)** - AI Signal Engine with ML integration
- **[Multi-Tenant Guide](docs/guides/MULTI_TENANT.md)** - Multi-user setup

### Reference Documentation

- **[API Reference](docs/reference/API_REFERENCE.md)** - All API endpoints
- **[Project Structure](docs/reference/PROJECT_STRUCTURE.md)** - Code organization
- **[Exchanges Reference](docs/reference/EXCHANGES.md)** - Exchange integrations
- **[Risk Limits](docs/reference/RISK_LIMITS.md)** - Risk management
- **[Webhook Limits](docs/reference/WEBHOOK_LIMITS.md)** - Subscription limits

### Development

- **[AI Studio Config Integration](docs/development/AI_STUDIO_CONFIG_INTEGRATION.md)** - Config system
- **[Arthur ML Integration](docs/development/ARTHUR_ML_INTEGRATION.md)** - ML service integration
- **[Auto-Retrain System](docs/development/AUTO_RETRAIN_SYSTEM.md)** - Self-improvement system

### Troubleshooting

- **[Common Issues](docs/troubleshooting/COMMON_ISSUES.md)** - Troubleshooting guide

---

## 🌐 Supported Exchanges

- **Aster DEX** - Crypto Futures
- **OANDA** - Forex
- **Tradier** - Stocks/ETFs/Options
- **Tastytrade** - Futures
- **Kalshi** - Prediction Markets
- **100+ Crypto Exchanges** - Via CCXT (Binance, Coinbase, Apex, Bybit, Kraken, OKX, etc.)

See [Exchange Reference](docs/reference/EXCHANGES.md) for complete list and details.

---

## 🏗️ System Architecture

```
TradingView Alerts → SignalStudio → Sparky Bot → Multiple Exchanges
                          ↓              ↓
                    Redis Cache    Supabase Database
```

**Data Flow:**
1. TradingView sends webhook alert to SignalStudio
2. SignalStudio validates and builds order
3. SignalStudio forwards order to Sparky Bot
4. Sparky Bot executes trade on exchange
5. Trade results logged to Supabase
6. Real-time analytics updated in SignalStudio dashboard

---

## 🔌 API Endpoints

- `POST /webhook` - Receives TradingView alerts (rate limited: 30 req/min)
- `GET /health` - Health check and bot status
- `GET /positions` - View current open positions
- `GET /api/strategies` - Strategy management endpoints
- `GET /api/market-data` - Market data for ML validation

See [API Reference](docs/reference/API_REFERENCE.md) for complete documentation.

---

## 🧪 Testing

```bash
# Test webhook locally
npm test

# Test Apex integration
npm run test:apex
```

---

## 📋 Prerequisites

- **Node.js** v18 or higher
- **Exchange API Credentials** - Configured in SignalStudio
- **Supabase Project** - For multi-tenant mode
- **DigitalOcean Droplet or VPS** - For 24/7 deployment
- **Redis** (optional) - For credential caching and rate limiting

---

## 🚀 Deployment

See [Deployment Guide](docs/guides/DEPLOYMENT.md) for detailed VPS setup instructions.

**Quick PM2 Setup:**
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## 🔗 Related Projects

- **SignalStudio Dashboard** - [`C:\Users\mjjoh\SignalStudio\signal`](../../SignalStudio/signal)
- **Arthur ML Service** - [`C:\Users\mjjoh\Arthur`](../../Arthur)

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🆘 Support

- **Setup Issues** → [Deployment Guide](docs/guides/DEPLOYMENT.md) and [TradingView Guide](docs/guides/TRADINGVIEW.md)
- **API Questions** → [API Reference](docs/reference/API_REFERENCE.md)
- **Integration Questions** → [Order Builder Integration](docs/guides/ORDER_BUILDER_INTEGRATION.md)
- **Troubleshooting** → [Troubleshooting Guide](docs/troubleshooting/COMMON_ISSUES.md)

---

**Version:** 1.0.0  
**Last Updated:** December 21, 2025
