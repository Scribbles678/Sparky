# Hyperliquid Integration Guide

This guide covers the integration of Hyperliquid DEX into the Sparky Trading Bot, enabling automated trading on Hyperliquid's high-performance Layer 1 blockchain.

## Overview

Hyperliquid is a decentralized exchange (DEX) built on a custom Layer 1 blockchain that offers:
- **High Performance**: Sub-second block times and low latency
- **EVM Compatibility**: Familiar development environment
- **Perpetual & Spot Trading**: Both perpetual futures and spot trading
- **Advanced Order Types**: Market, limit, stop loss, take profit orders
- **API Wallet System**: Secure API key management

## Features

### ✅ Implemented Features
- **Multi-Asset Support**: Both perpetual futures and spot trading
- **Order Management**: Market, limit, stop loss, and take profit orders
- **Position Tracking**: Real-time position monitoring and P&L calculation
- **Risk Management**: Position sizing and margin management
- **API Authentication**: Secure signature-based authentication
- **Symbol Management**: Automatic asset ID resolution
- **Precision Handling**: Proper price and size rounding per asset rules

### 🔄 Trading Capabilities
- **Perpetual Futures**: Trade crypto perpetuals with leverage
- **Spot Trading**: Trade spot pairs (e.g., BTC/USDC, ETH/USDC)
- **Order Types**: Market, limit, stop loss, take profit
- **Time in Force**: GTC (Good Till Cancel), IOC (Immediate or Cancel), ALO (Add Liquidity Only)
- **Position Management**: Long/short positions with automatic reversal

## Configuration

### 1. API Setup

#### Get API Credentials
1. Visit [Hyperliquid App](https://app.hyperliquid.xyz)
2. Connect your wallet
3. Go to Settings → API
4. Create a new API wallet (agent wallet)
5. Copy the API wallet address and private key

#### Environment Variables
Add to your `.env` file:
```bash
# Hyperliquid Configuration
HYPERLIQUID_API_KEY=0x1234567890abcdef1234567890abcdef12345678
HYPERLIQUID_PRIVATE_KEY=0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
HYPERLIQUID_BASE_URL=https://api.hyperliquid.xyz
HYPERLIQUID_IS_TESTNET=false
```

### 2. Bot Configuration

Add to your `config.json`:
```json
{
  "hyperliquid": {
    "apiKey": "0x1234567890abcdef1234567890abcdef12345678",
    "privateKey": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    "baseUrl": "https://api.hyperliquid.xyz",
    "isTestnet": false,
    "tradeAmount": 300
  }
}
```

### 3. Testnet Configuration

For testing, use the testnet:
```json
{
  "hyperliquid": {
    "apiKey": "YOUR_TESTNET_API_WALLET",
    "privateKey": "YOUR_TESTNET_PRIVATE_KEY",
    "baseUrl": "https://api.hyperliquid-testnet.xyz",
    "isTestnet": true,
    "tradeAmount": 100
  }
}
```

## Trading Details

### Supported Symbols

#### Perpetual Futures
- **BTC**: Bitcoin perpetual
- **ETH**: Ethereum perpetual
- **SOL**: Solana perpetual
- **ARB**: Arbitrum perpetual
- And many more...

#### Spot Trading
- **BTC/USDC**: Bitcoin spot
- **ETH/USDC**: Ethereum spot
- **SOL/USDC**: Solana spot
- **ARB/USDC**: Arbitrum spot
- And more...

### Webhook Format

TradingView alerts should include the `exchange` field:
```json
{
  "ticker": "BTC",
  "action": "buy",
  "exchange": "hyperliquid",
  "strategy": "my_strategy",
  "price": 50000,
  "stop_loss": 48000,
  "take_profit": 52000
}
```

### Order Types

#### Market Orders
```javascript
// Place market buy order
await hyperliquidAPI.placeMarketOrder('BTC', 'buy', 0.1);

// Place market sell order  
await hyperliquidAPI.placeMarketOrder('BTC', 'sell', 0.1);
```

#### Limit Orders
```javascript
// Place limit buy order
await hyperliquidAPI.placeLimitOrder('BTC', 'buy', 0.1, 49000);

// Place limit sell order
await hyperliquidAPI.placeLimitOrder('BTC', 'sell', 0.1, 51000);
```

#### Stop Loss Orders
```javascript
// Place stop loss order
await hyperliquidAPI.placeStopLoss('BTC', 'sell', 0.1, 48000);
```

#### Take Profit Orders
```javascript
// Place take profit order
await hyperliquidAPI.placeTakeProfit('BTC', 'sell', 0.1, 52000);
```

## API Endpoints

### Info Endpoint (Public Data)
- **Base URL**: `https://api.hyperliquid.xyz/info`
- **Purpose**: Market data, account info, positions
- **Authentication**: None required

### Exchange Endpoint (Trading)
- **Base URL**: `https://api.hyperliquid.xyz/exchange`
- **Purpose**: Place orders, cancel orders, account management
- **Authentication**: API wallet signature required

## Risk Management

### Position Sizing
- **Default**: $300 per trade (configurable)
- **Maximum**: Based on available margin
- **Precision**: Rounded to asset-specific decimal places

### Margin Requirements
- **Initial Margin**: Varies by asset and leverage
- **Maintenance Margin**: Lower threshold for position maintenance
- **Liquidation**: Automatic liquidation if margin falls below threshold

### Order Limits
- **Rate Limits**: 100 requests per second
- **Position Limits**: Maximum concurrent positions per asset
- **Size Limits**: Minimum and maximum order sizes per asset

## Network Information

### Mainnet
- **RPC URL**: `https://api.hyperliquid.xyz`
- **Chain ID**: 421614
- **Block Time**: ~1 second
- **Gas**: Paid in USDC

### Testnet
- **RPC URL**: `https://api.hyperliquid-testnet.xyz`
- **Chain ID**: 998
- **Block Time**: ~1 second
- **Gas**: Paid in test USDC

## Troubleshooting

### Common Issues

#### 1. Authentication Errors
```
Error: Invalid signature
```
**Solution**: Verify API wallet address and private key are correct

#### 2. Asset Not Found
```
Error: Asset not found: BTC
```
**Solution**: Check symbol format and ensure asset is supported

#### 3. Insufficient Margin
```
Error: Insufficient margin
```
**Solution**: Reduce position size or add more funds

#### 4. Invalid Order Size
```
Error: Invalid size
```
**Solution**: Check asset-specific size requirements and rounding rules

### Debug Mode

Enable debug logging:
```javascript
// In your config
{
  "hyperliquid": {
    "debug": true,
    "logLevel": "debug"
  }
}
```

### Testing

Run the integration test:
```bash
node test/testHyperliquidIntegration.js
```

## Security Best Practices

### 1. API Key Management
- **Never commit** API keys to version control
- **Use environment variables** for sensitive data
- **Rotate keys** regularly
- **Use separate keys** for testnet and mainnet

### 2. Private Key Security
- **Store securely** in encrypted environment variables
- **Never share** private keys
- **Use hardware wallets** when possible
- **Monitor** for unauthorized access

### 3. Network Security
- **Use HTTPS** for all API calls
- **Validate** all incoming webhook data
- **Implement** rate limiting
- **Monitor** for suspicious activity

## Example Pine Script Strategy

```pinescript
//@version=5
strategy("Hyperliquid BTC Strategy", overlay=true)

// Strategy parameters
rsi_length = input(14, "RSI Length")
rsi_overbought = input(70, "RSI Overbought")
rsi_oversold = input(30, "RSI Oversold")

// RSI calculation
rsi = ta.rsi(close, rsi_length)

// Entry conditions
long_condition = ta.crossover(rsi, rsi_oversold)
short_condition = ta.crossunder(rsi, rsi_overbought)

// Exit conditions
long_exit = ta.crossunder(rsi, rsi_overbought)
short_exit = ta.crossover(rsi, rsi_oversold)

// Strategy logic
if long_condition
    strategy.entry("Long", strategy.long)
    alert("{\"ticker\":\"BTC\",\"action\":\"buy\",\"exchange\":\"hyperliquid\",\"strategy\":\"rsi_strategy\",\"price\":" + str.tostring(close) + "}", alert.freq_once_per_bar)

if short_condition
    strategy.entry("Short", strategy.short)
    alert("{\"ticker\":\"BTC\",\"action\":\"sell\",\"exchange\":\"hyperliquid\",\"strategy\":\"rsi_strategy\",\"price\":" + str.tostring(close) + "}", alert.freq_once_per_bar)

if long_exit
    strategy.close("Long")
    alert("{\"ticker\":\"BTC\",\"action\":\"close\",\"exchange\":\"hyperliquid\",\"strategy\":\"rsi_strategy\",\"price\":" + str.tostring(close) + "}", alert.freq_once_per_bar)

if short_exit
    strategy.close("Short")
    alert("{\"ticker\":\"BTC\",\"action\":\"close\",\"exchange\":\"hyperliquid\",\"strategy\":\"rsi_strategy\",\"price\":" + str.tostring(close) + "}", alert.freq_once_per_bar)
```

## Performance Considerations

### 1. API Rate Limits
- **Info Endpoint**: 100 requests/second
- **Exchange Endpoint**: 100 requests/second
- **WebSocket**: 1000 messages/second

### 2. Order Batching
- **Batch orders** when possible
- **Separate IOC and GTC** orders
- **Use ALO orders** for market making

### 3. Nonce Management
- **Generate unique nonces** for each request
- **Use atomic counters** for nonce generation
- **Handle nonce conflicts** gracefully

## Monitoring and Alerts

### 1. Position Monitoring
- **Real-time P&L** tracking
- **Margin utilization** monitoring
- **Position size** alerts

### 2. Order Monitoring
- **Order status** tracking
- **Fill notifications** 
- **Error alerts**

### 3. System Health
- **API connectivity** monitoring
- **Rate limit** tracking
- **Error rate** monitoring

## Support and Resources

### Documentation
- [Hyperliquid API Docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api)
- [Hyperliquid Python SDK](https://github.com/hyperliquid-dex/hyperliquid-python-sdk)
- [CCXT Integration](https://docs.ccxt.com/#/exchanges/hyperliquid)

### Community
- [Hyperliquid Discord](https://discord.gg/hyperliquid)
- [Hyperliquid Twitter](https://twitter.com/hyperliquiddex)
- [Hyperliquid GitHub](https://github.com/hyperliquid-dex)

### Support
- **Technical Issues**: Check logs and error messages
- **API Issues**: Verify credentials and network connectivity
- **Trading Issues**: Check margin and position limits

---

## Quick Start Checklist

- [ ] Set up Hyperliquid account and API wallet
- [ ] Add credentials to `.env` file
- [ ] Update `config.json` with Hyperliquid configuration
- [ ] Test with testnet first
- [ ] Run integration tests
- [ ] Set up TradingView alerts with `exchange: "hyperliquid"`
- [ ] Monitor first trades carefully
- [ ] Scale up position sizes gradually

**Happy Trading! 🚀**
