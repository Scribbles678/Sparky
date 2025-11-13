# Lighter DEX Integration Guide

## Overview

The Sparky Trading Bot now supports **Lighter DEX**, a decentralized perpetual exchange on zkSync. This integration allows you to trade crypto perpetuals with up to 100x leverage through the same webhook-driven interface.

## Features

- ✅ **Market & Limit Orders** - Full order type support
- ✅ **Stop Loss & Take Profit** - Risk management built-in
- ✅ **Position Management** - Real-time position tracking
- ✅ **Multi-Exchange Support** - Trade on Lighter alongside Aster, OANDA, and Tradier
- ✅ **Strategy Tracking** - Full integration with strategy management system
- ✅ **Database Logging** - All trades logged to Supabase for TradeFI dashboard

## Configuration

### 1. Environment Variables

Add these to your `.env` file:

```env
# =============================================================================
# LIGHTER DEX (CRYPTO PERPS) CONFIGURATION
# =============================================================================
LIGHTER_API_KEY=your_lighter_api_key_here
LIGHTER_PRIVATE_KEY=your_eth_private_key_here
LIGHTER_ACCOUNT_INDEX=0
LIGHTER_API_KEY_INDEX=2
LIGHTER_BASE_URL=https://mainnet.zklighter.elliot.ai
```

### 2. Config.json

Add Lighter configuration to your `config.json`:

```json
{
  "lighter": {
    "apiKey": "YOUR_LIGHTER_API_KEY",
    "privateKey": "YOUR_ETH_PRIVATE_KEY",
    "accountIndex": 0,
    "apiKeyIndex": 2,
    "baseUrl": "https://mainnet.zklighter.elliot.ai",
    "tradeAmount": 500
  }
}
```

## Getting Started

### 1. Create Lighter Account

1. Visit [Lighter DEX](https://lighter.xyz)
2. Connect your wallet (MetaMask, etc.)
3. Create an account and get your account index
4. Generate API keys in the account settings

### 2. Get API Credentials

- **API Key**: Generated in Lighter account settings
- **Private Key**: Your Ethereum private key (same as wallet)
- **Account Index**: Your account number (usually 0 for main account)
- **API Key Index**: Index for this API key (2-254, default: 2)

### 3. Test Configuration

```bash
# Test the integration
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-webhook-secret",
    "symbol": "BTC-USD",
    "action": "BUY",
    "orderType": "MARKET",
    "stopLoss": 2,
    "takeProfit": 5,
    "exchange": "lighter"
  }'
```

## Trading

### Supported Symbols

Lighter DEX supports various crypto perpetuals. Common symbols include:
- `BTC-USD` - Bitcoin perpetual
- `ETH-USD` - Ethereum perpetual
- `SOL-USD` - Solana perpetual
- And many more...

### Webhook Format

```json
{
  "secret": "your-webhook-secret",
  "symbol": "BTC-USD",
  "action": "BUY",
  "orderType": "MARKET",
  "stopLoss": 2,
  "takeProfit": 5,
  "exchange": "lighter"
}
```

### Order Types

- **Market Orders**: `"orderType": "MARKET"`
- **Limit Orders**: `"orderType": "LIMIT"` (requires `price` field)
- **Stop Loss**: Automatically placed based on `stopLoss` percentage
- **Take Profit**: Automatically placed based on `takeProfit` percentage

## API Endpoints

### Health Check
```bash
curl http://localhost:3000/health
```

### Get Positions
```bash
curl http://localhost:3000/positions
```

### Test Webhook
```bash
curl -X POST http://localhost:3000/webhook/test \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

## Risk Management

### Position Sizing
- **Fixed Amount**: Each trade uses the configured `tradeAmount` (default: $500)
- **Leverage**: Set on Lighter DEX interface (up to 100x)
- **Risk**: Stop loss and take profit are percentage-based

### Example Trade
- **Position Size**: $500
- **Stop Loss**: 2% = $10 risk
- **Take Profit**: 5% = $25 profit
- **Risk/Reward**: 1:2.5

## Network Information

- **Network**: zkSync Era (L2)
- **Base Currency**: USDC
- **Gas Fees**: Low (L2 benefits)
- **Settlement**: Real-time

## Troubleshooting

### Common Issues

1. **API Key Invalid**
   - Verify API key is correct
   - Check account index
   - Ensure API key is active

2. **Insufficient Balance**
   - Deposit USDC to your Lighter account
   - Check available balance

3. **Symbol Not Found**
   - Verify symbol format (e.g., `BTC-USD` not `BTCUSDT`)
   - Check if symbol is available on Lighter

4. **Order Failed**
   - Check leverage settings
   - Verify sufficient margin
   - Check market hours

### Debug Mode

Enable debug logging:

```env
LOG_LEVEL=debug
```

### Logs

Check logs for detailed information:
```bash
tail -f logs/combined.log
tail -f logs/error.log
tail -f logs/trades.log
```

## Security

### Best Practices

1. **Private Key Security**
   - Never share your private key
   - Use environment variables
   - Consider using a dedicated trading wallet

2. **API Key Management**
   - Use different API keys for different purposes
   - Regularly rotate API keys
   - Monitor API key usage

3. **Position Limits**
   - Set reasonable position sizes
   - Use stop losses
   - Monitor positions regularly

## Support

### Lighter DEX Resources
- [Official Documentation](https://apidocs.lighter.xyz)
- [Discord Community](https://discord.gg/lighter)
- [Twitter](https://twitter.com/lighter_xyz)

### Sparky Bot Support
- Check logs for error details
- Verify configuration
- Test with small amounts first

## Example Trading Strategy

```javascript
// TradingView Pine Script example
//@version=5
strategy("Lighter DEX Strategy", overlay=true)

// Your strategy logic
fastMA = ta.sma(close, 20)
slowMA = ta.sma(close, 50)

bullSignal = ta.crossover(fastMA, slowMA)
bearSignal = ta.crossunder(fastMA, slowMA)

if bullSignal
    strategy.entry("Long", strategy.long)
    alert('{"secret":"your-webhook-secret","symbol":"BTC-USD","action":"BUY","orderType":"MARKET","stopLoss":2,"takeProfit":5,"exchange":"lighter"}', alert.freq_once_per_bar)

if bearSignal
    strategy.entry("Short", strategy.short)
    alert('{"secret":"your-webhook-secret","symbol":"BTC-USD","action":"SELL","orderType":"MARKET","stopLoss":2,"takeProfit":5,"exchange":"lighter"}', alert.freq_once_per_bar)
```

## Changelog

### v1.0.0 - Initial Lighter Integration
- ✅ Added LighterAPI class
- ✅ Updated ExchangeFactory
- ✅ Added configuration support
- ✅ Integrated with position tracking
- ✅ Added database logging
- ✅ Updated documentation

---

**Ready to trade on Lighter DEX!** 🚀

For questions or issues, check the logs and verify your configuration.
