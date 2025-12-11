/**
 * AI Decision Parser
 * 
 * Parses and validates AI responses from LLM (Groq/Grok)
 * Handles various response formats and ensures valid output
 */

const logger = require('../../utils/logger');

/**
 * Parse AI decision from LLM response
 * @param {string} text - Raw LLM response
 * @returns {Object} Parsed decision object
 */
function parseDecision(text) {
  try {
    if (!text || typeof text !== 'string') {
      logger.warn('Empty or invalid AI response');
      return createHoldDecision('Empty response');
    }

    // Try to extract JSON from response (handles markdown code blocks)
    let jsonText = text.trim();
    
    // Remove markdown code blocks if present
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Try to find JSON object
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonText);

    // Validate and normalize action
    const action = (parsed.action || 'HOLD').toUpperCase();
    const validActions = ['LONG', 'SHORT', 'CLOSE', 'HOLD'];
    
    if (!validActions.includes(action)) {
      logger.warn(`Invalid action from AI: ${action}, defaulting to HOLD`);
      return createHoldDecision(`Invalid action: ${action}`);
    }

    // Normalize symbol format (remove slashes, colons, convert to uppercase)
    let symbol = parsed.symbol || 'BTCUSDT';
    symbol = symbol.replace(/\//g, '').replace(/:/g, '').toUpperCase();
    
    // Remove common suffixes if present
    symbol = symbol.replace(/:PERP$/, '').replace(/-PERP$/, '');

    // Validate and clamp size
    let sizeUsd = Number(parsed.size_usd) || 0;
    sizeUsd = Math.max(0, Math.min(100000, sizeUsd)); // Clamp between 0 and 100k

    // Validate and clamp confidence
    let confidence = Number(parsed.confidence) || 0.5;
    confidence = Math.max(0, Math.min(1, confidence)); // Clamp between 0 and 1

    // Validate reasoning
    const reasoning = (parsed.reasoning || '').substring(0, 100).trim();

    return {
      action,
      symbol,
      size_usd: sizeUsd,
      confidence,
      reasoning: reasoning || 'No reasoning provided'
    };
  } catch (error) {
    logger.logError('Failed to parse AI decision', error, { text: text.substring(0, 200) });
    return createHoldDecision('Parse error: ' + error.message);
  }
}

/**
 * Create a HOLD decision (fallback)
 * @param {string} reason - Reason for holding
 * @returns {Object} Hold decision object
 */
function createHoldDecision(reason) {
  return {
    action: 'HOLD',
    symbol: 'BTCUSDT',
    size_usd: 0,
    confidence: 0,
    reasoning: reason || 'Error parsing decision'
  };
}

module.exports = { parseDecision };

