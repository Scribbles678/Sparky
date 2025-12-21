/**
 * Balanced Risk Profile Prompt Builder
 * 
 * Builds prompts for AI trading decisions with balanced risk profile.
 * This is the default prompt template - can be customized per strategy.
 */

/**
 * Build AI prompt for trading decision
 * @param {Object} params - Strategy and market data
 * @param {Object} params.strategy - AI strategy configuration
 * @param {Array} params.priceData - OHLCV candle array
 * @param {Object} params.indicators - Technical indicators
 * @param {Array} params.currentPositions - User's current positions
 * @param {string} params.customPrompt - Optional custom trading instructions (Phase 1)
 * @returns {string} Formatted prompt
 */
function buildPrompt({ strategy, priceData, indicators, currentPositions, customPrompt }) {
  const positionsSummary = currentPositions.length > 0
    ? currentPositions.map(p => 
        `${p.symbol}: ${p.side} ${p.quantity || 0} @ $${p.entry_price || 0} (P&L: $${(p.unrealized_pnl_usd || 0).toFixed(2)})`
      ).join('\n')
    : 'No open positions';

  // Format recent price action (last 10 candles)
  const recentCandles = priceData && priceData.length > 0
    ? priceData.slice(-10).map(c => ({
        time: new Date(c.time).toISOString(),
        open: c.open.toFixed(2),
        high: c.high.toFixed(2),
        low: c.low.toFixed(2),
        close: c.close.toFixed(2),
        volume: c.volume.toFixed(2)
      }))
    : [];

  // Phase 1: Build custom instructions section if provided
  let customInstructions = '';
  if (customPrompt && customPrompt.trim()) {
    customInstructions = `

--- CUSTOM TRADING INSTRUCTIONS ---
${customPrompt.trim()}
--- END CUSTOM INSTRUCTIONS ---
`;
  }

  return `You are an elite crypto quant trader with 8 years of experience and a 2.1 Sharpe ratio over 5 years.

RISK PROFILE: ${strategy.risk_profile || 'balanced'}
MAX DRAWDOWN ALLOWED: ${strategy.max_drawdown_percent || 20}%
MAX LEVERAGE: ${strategy.leverage_max || 10}x
TARGET ASSETS: ${(strategy.target_assets || []).join(', ')}

CURRENT OPEN POSITIONS:
${positionsSummary}

MARKET DATA (Last 100 candles, 1-minute):
Current Price: $${(indicators.currentPrice || 0).toFixed(2)}
SMA 20: ${indicators.sma20 ? '$' + indicators.sma20.toFixed(2) : 'N/A'}
SMA 50: ${indicators.sma50 ? '$' + indicators.sma50.toFixed(2) : 'N/A'}
RSI: ${indicators.rsi ? indicators.rsi.toFixed(2) : 'N/A'}
24h Change: ${indicators.priceChange24h ? indicators.priceChange24h.toFixed(2) + '%' : 'N/A'}

Recent price action (last 10 candles):
${JSON.stringify(recentCandles, null, 2)}
${customInstructions}
INSTRUCTIONS:
1. Analyze the market data and current positions
2. Decide on action: LONG, SHORT, CLOSE, or HOLD
3. If LONG/SHORT, specify position size in USD (respect max leverage and risk profile)
4. Provide confidence score (0.0 to 1.0)
5. Give brief reasoning (max 15 words)

RISK RULES:
- If RSI > 70, avoid LONG positions
- If RSI < 30, avoid SHORT positions
- If max drawdown is approaching, reduce position size or CLOSE
- Never exceed max leverage
- Consider current positions when deciding (don't over-leverage)

Return ONLY valid JSON. No markdown. No explanation outside JSON.

{
  "action": "LONG" | "SHORT" | "CLOSE" | "HOLD",
  "symbol": "BTCUSDT" | "ETHUSDT" | etc,
  "size_usd": 2500,
  "confidence": 0.87,
  "reasoning": "short explanation under 15 words"
}`;
}

module.exports = { buildPrompt };

