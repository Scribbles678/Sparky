# Sparky Trading Bot 🚀

A headless trading bot that receives TradingView webhook alerts and executes trades on multiple exchanges (Aster DEX, OANDA, Tradier, and 100+ via CCXT) with simple percentage-based stop loss and take profit.

**Part of the SignalStudio Trading Ecosystem:**
- **SignalStudio Dashboard** - Real-time analytics, strategy management, and webhook processing (`app.signal-studio.co`)
- **Sparky Bot** (this repo) - Executes trades on multiple exchanges (VPS/DigitalOcean)

## Quick Start

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

## Features

- 🔔 Multi-exchange trading (Aster, OANDA, Tradier, 100+ via CCXT)
- 🤖 AI Signal Engine (Groq LLM-based trading signals)
- 👥 Copy Trading (Automatic trade replication)
- 🛡️ Risk Management (Weekly trade/loss limits)
- 📊 Subscription Limits (Monthly webhook quotas)
- 🔐 Multi-tenant architecture (Per-user credentials)
- 📈 Real-time position tracking
- 🗄️ Supabase integration for analytics

## Supported Exchanges

- **Aster DEX** - Crypto Futures
- **OANDA** - Forex
- **Tradier** - Stocks/ETFs/Options
- **100+ Crypto Exchanges** - Via CCXT (Binance, Coinbase, Apex, etc.)

## Documentation

📚 **Full documentation:** [`docs/README.md`](docs/README.md)

### Quick Links

- [Deployment Guide](docs/guides/DEPLOYMENT.md) - VPS setup
- [TradingView Setup](docs/guides/TRADINGVIEW.md) - Webhook configuration
- [AI Worker Guide](docs/guides/AI_WORKER.md) - AI Signal Engine setup
- [Copy Trading Guide](docs/guides/COPY_TRADING.md) - Copy trading feature
- [Exchange Reference](docs/reference/EXCHANGES.md) - Exchange details

## Prerequisites

- Node.js v18 or higher
- Exchange API credentials (configured in SignalStudio)
- Supabase project (for multi-tenant mode)
- DigitalOcean droplet or VPS (for 24/7 deployment)

## System Architecture

```
TradingView Alerts → SignalStudio → Sparky Bot → Multiple Exchanges
                          ↓              ↓
                    Redis Cache    Supabase Database
```

## API Endpoints

- `POST /webhook` - Receives TradingView alerts (rate limited: 30 req/min)
- `GET /health` - Health check and bot status
- `GET /positions` - View current open positions

## Testing

```bash
# Test webhook locally
npm test

# Test Apex integration
npm run test:apex
```

## License

MIT License - see [LICENSE](LICENSE) file for details

## Support

For detailed documentation, troubleshooting, and guides, see [`docs/README.md`](docs/README.md).

---

**Version:** 1.0.0  
**Last Updated:** December 2025

