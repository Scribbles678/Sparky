# Sparky Trading Bot - Documentation Index

> **📖 Main Project README:** [../README.md](../README.md)

This is the documentation hub for Sparky Trading Bot. Use this index to navigate all guides, references, and development documentation.

---

## 🎯 Quick Navigation

**New to Sparky?** Start here:

1. **[Main README](../README.md)** - Project overview and quick start
2. **[Deployment Guide](guides/DEPLOYMENT.md)** - Deploy to VPS
3. **[TradingView Setup](guides/TRADINGVIEW.md)** - Webhook configuration
4. **[AI Worker Guide](guides/AI_WORKER.md)** - AI Signal Engine setup

---

## 📚 Documentation Structure

### 🚀 Getting Started

- **[Main README](../README.md)** - Project overview and quick start
- **[Deployment Guide](guides/DEPLOYMENT.md)** - VPS deployment
- **[TradingView Setup](guides/TRADINGVIEW.md)** - Webhook configuration
- **[Multi-Tenant Guide](guides/MULTI_TENANT.md)** - Multi-user setup

### 📖 Reference (`reference/`)

Technical reference documentation:

- **[API Reference](reference/API_REFERENCE.md)** - All API endpoints
- **[Project Structure](reference/PROJECT_STRUCTURE.md)** - Code organization
- **[Exchanges](reference/EXCHANGES.md)** - Exchange integrations and details
- **[Strategies](reference/STRATEGIES.md)** - Strategy metadata and configuration
- **[Risk Limits](reference/RISK_LIMITS.md)** - Risk management
- **[Webhook Limits](reference/WEBHOOK_LIMITS.md)** - Subscription-based limits
- **Exchange Implementation Guides:**
  - [Aster](reference/ALPACA_IMPLEMENTATION.md), [OANDA](reference/CAPITAL_IMPLEMENTATION.md), [Tradier](reference/ETRADE_IMPLEMENTATION.md)
  - [100+ CCXT Exchanges](reference/EXCHANGES.md)

### 📘 Guides (`guides/`)

Step-by-step guides:

- **[AI Worker](guides/AI_WORKER.md)** - AI Signal Engine setup and ML integration
- **[Order Builder Integration](guides/ORDER_BUILDER_INTEGRATION.md)** - SignalStudio order building
- **[Notifications](guides/NOTIFICATIONS.md)** - Server-side notifications
- **[Kalshi Setup](guides/KALSHI_SETUP.md)** - Kalshi exchange setup
- **[Alert Templates](guides/alert%20templates.md)** - TradingView alert templates

### 💻 Development (`development/`)

Developer documentation:

- **[AI Studio Config Integration](development/AI_STUDIO_CONFIG_INTEGRATION.md)** - How Sparky uses AI Studio config
- **[Arthur ML Integration](development/ARTHUR_ML_INTEGRATION.md)** - ML service integration
- **[Auto-Retrain System](development/AUTO_RETRAIN_SYSTEM.md)** - Self-improvement system

### 🐛 Troubleshooting (`troubleshooting/`)

- **[Common Issues](troubleshooting/COMMON_ISSUES.md)** - Troubleshooting guide

---

## 🎯 Common Tasks

### For Users

- **Deploy Sparky** → [Deployment Guide](guides/DEPLOYMENT.md)
- **Set Up TradingView** → [TradingView Guide](guides/TRADINGVIEW.md)
- **Configure AI Strategies** → [AI Worker Guide](guides/AI_WORKER.md)

### For Developers

- **Understand Architecture** → [Project Structure](reference/PROJECT_STRUCTURE.md)
- **API Endpoints** → [API Reference](reference/API_REFERENCE.md)
- **Exchange Integration** → [Exchanges Reference](reference/EXCHANGES.md)
- **AI Studio Integration** → [AI Studio Config Integration](development/AI_STUDIO_CONFIG_INTEGRATION.md)
- **ML Integration** → [Arthur ML Integration](development/ARTHUR_ML_INTEGRATION.md)

### For Operations

- **Deploy to Production** → [Deployment Guide](guides/DEPLOYMENT.md)
- **Monitor Health** → [API Reference](reference/API_REFERENCE.md#health-check)
- **Troubleshoot Issues** → [Troubleshooting Guide](troubleshooting/COMMON_ISSUES.md)

---

## 📋 Documentation by Topic

### Trading & Execution

- [TradingView Setup](guides/TRADINGVIEW.md) - Webhook configuration
- [Order Builder Integration](guides/ORDER_BUILDER_INTEGRATION.md) - SignalStudio integration
- [Exchanges Reference](reference/EXCHANGES.md) - Exchange details
- [API Reference](reference/API_REFERENCE.md) - Trade endpoints

### AI & Machine Learning

- [AI Worker Guide](guides/AI_WORKER.md) - AI Signal Engine
- [AI Studio Config Integration](development/AI_STUDIO_CONFIG_INTEGRATION.md) - Config system
- [Arthur ML Integration](development/ARTHUR_ML_INTEGRATION.md) - ML service
- [Auto-Retrain System](development/AUTO_RETRAIN_SYSTEM.md) - Self-improvement

### Risk Management

- [Risk Limits](reference/RISK_LIMITS.md) - Risk management
- [Webhook Limits](reference/WEBHOOK_LIMITS.md) - Subscription limits
- [Multi-Tenant Guide](guides/MULTI_TENANT.md) - Multi-user setup

### Deployment & Operations

- [Deployment Guide](guides/DEPLOYMENT.md) - Production deployment
- [Troubleshooting](troubleshooting/COMMON_ISSUES.md) - Common issues
- [Notifications](guides/NOTIFICATIONS.md) - Notification system

---

## 📁 File Structure

```
docs/
├── README.md (this file)
│
├── guides/
│   ├── AI_WORKER.md
│   ├── DEPLOYMENT.md
│   ├── MULTI_TENANT.md
│   ├── NOTIFICATIONS.md
│   ├── ORDER_BUILDER_INTEGRATION.md
│   ├── TRADINGVIEW.md
│   ├── KALSHI_SETUP.md
│   └── alert templates.md
│
├── reference/
│   ├── API_REFERENCE.md
│   ├── PROJECT_STRUCTURE.md
│   ├── EXCHANGES.md
│   ├── STRATEGIES.md
│   ├── RISK_LIMITS.md
│   ├── WEBHOOK_LIMITS.md
│   └── [Exchange Implementation Guides]
│
├── development/
│   ├── AI_STUDIO_CONFIG_INTEGRATION.md
│   ├── ARTHUR_ML_INTEGRATION.md
│   └── AUTO_RETRAIN_SYSTEM.md
│
├── troubleshooting/
│   └── COMMON_ISSUES.md
│
├── schema/
│   └── [SQL migration files]
│
└── roadmap/
    └── [Future plans]
```

---

## 🔍 Finding What You Need

### "I want to..."

- **Deploy Sparky** → [Deployment Guide](guides/DEPLOYMENT.md)
- **Set up TradingView webhooks** → [TradingView Guide](guides/TRADINGVIEW.md)
- **Configure AI strategies** → [AI Worker Guide](guides/AI_WORKER.md)
- **Understand the API** → [API Reference](reference/API_REFERENCE.md)
- **Integrate with SignalStudio** → [Order Builder Integration](guides/ORDER_BUILDER_INTEGRATION.md)
- **Set up ML predictions** → [Arthur ML Integration](development/ARTHUR_ML_INTEGRATION.md)
- **Troubleshoot issues** → [Troubleshooting Guide](troubleshooting/COMMON_ISSUES.md)
- **Understand architecture** → [Project Structure](reference/PROJECT_STRUCTURE.md)

---

## 🔄 Documentation Updates

This documentation is actively maintained. When updating:

1. **Update the relevant guide** in the appropriate folder
2. **Update this README** if structure changes
3. **Update cross-references** in related docs
4. **Keep paths accurate** - use relative paths from docs root

---

## 📞 Need Help?

- **Setup Issues** → Check [Deployment Guide](guides/DEPLOYMENT.md) and [TradingView Guide](guides/TRADINGVIEW.md)
- **API Questions** → See [API Reference](reference/API_REFERENCE.md)
- **Integration Questions** → See [Order Builder Integration](guides/ORDER_BUILDER_INTEGRATION.md)
- **Troubleshooting** → See [Troubleshooting Guide](troubleshooting/COMMON_ISSUES.md)

---

## 🎯 Documentation Status

- ✅ **User Guides** - Complete
- ✅ **API Reference** - Complete
- ✅ **Exchange Documentation** - Complete
- ✅ **AI/ML Integration** - Complete
- ✅ **Deployment** - Complete
- ✅ **Troubleshooting** - Complete

---

## 🔗 Related Documentation

- **SignalStudio Dashboard:** [`C:\Users\mjjoh\SignalStudio\signal\docs`](../../../SignalStudio/signal/docs/README.md)
- **Arthur ML Service:** [`C:\Users\mjjoh\Arthur\docs`](../../../Arthur/docs/README.md)

---

**Last Updated:** December 21, 2025  
**Version:** 2.1 (Consolidated with main README)
