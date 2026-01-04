/**
 * Market Structure Service for Sparky Trading Bot
 * 
 * Calculates market structure features for live trading:
 * - Swing points (HH, HL, LH, LL)
 * - Supply/Demand zones
 * - Break of Structure (BOS/ChoCH)
 * - Trend direction
 * 
 * This is a JavaScript implementation of the Python MarketStructureAnalyzer
 * for real-time feature calculation in Sparky.
 * 
 * @module services/marketStructure
 */

const logger = require('../utils/logger');

/**
 * Swing point types
 */
const SwingType = {
  HIGHER_HIGH: 'HH',
  LOWER_HIGH: 'LH',
  HIGHER_LOW: 'HL',
  LOWER_LOW: 'LL'
};

/**
 * Trend direction
 */
const TrendDirection = {
  BULLISH: 'bullish',
  BEARISH: 'bearish',
  RANGING: 'ranging'
};

/**
 * MarketStructureAnalyzer - Real-time market structure analysis
 */
class MarketStructureAnalyzer {
  /**
   * @param {Object} options - Configuration options
   * @param {number} options.swingLength - Bars to look for swing detection (default: 10)
   * @param {number} options.zoneAtrMultiplier - ATR multiplier for zone height (default: 1.5)
   * @param {number} options.maxZones - Maximum zones to track (default: 10)
   */
  constructor(options = {}) {
    this.swingLength = options.swingLength || 10;
    this.zoneAtrMultiplier = options.zoneAtrMultiplier || 1.5;
    this.maxZones = options.maxZones || 10;
    
    // State
    this.swingPoints = [];
    this.supplyZones = [];
    this.demandZones = [];
    this.structureBreaks = [];
    this.currentTrend = TrendDirection.RANGING;
    this.lastAtr = null;
    
    // Candle history for calculations
    this.candles = [];
  }

  /**
   * Add a new candle and update analysis
   * @param {Object} candle - OHLCV candle {open, high, low, close, volume, timestamp}
   * @returns {Object} Updated market structure features
   */
  update(candle) {
    // Add candle to history
    this.candles.push({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      timestamp: candle.timestamp
    });

    // Keep limited history (enough for swing detection + buffer)
    const maxCandles = this.swingLength * 3 + 50;
    if (this.candles.length > maxCandles) {
      this.candles = this.candles.slice(-maxCandles);
    }

    // Update calculations
    this._updateAtr();
    this._detectSwingPoints();
    this._updateZones();
    this._detectStructureBreaks(candle.close);
    this._updateTrend();

    return this.getFeatures(candle.close);
  }

  /**
   * Initialize with historical candles
   * @param {Array} candles - Array of OHLCV candles
   */
  initialize(candles) {
    this.candles = [];
    this.swingPoints = [];
    this.supplyZones = [];
    this.demandZones = [];
    this.structureBreaks = [];

    // Process historical candles
    candles.forEach(candle => {
      this.candles.push({
        open: candle.open || candle.o,
        high: candle.high || candle.h,
        low: candle.low || candle.l,
        close: candle.close || candle.c,
        volume: candle.volume || candle.v,
        timestamp: candle.timestamp || candle.time
      });
    });

    // Run full analysis
    this._updateAtr();
    this._detectSwingPoints();
    this._updateZones();
    
    const lastClose = this.candles.length > 0 ? this.candles[this.candles.length - 1].close : 0;
    this._detectStructureBreaks(lastClose);
    this._updateTrend();

    logger.info(`[MarketStructure] Initialized with ${candles.length} candles, ${this.swingPoints.length} swings detected`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ATR CALCULATION
  // ═══════════════════════════════════════════════════════════════════════════

  _updateAtr(period = 14) {
    if (this.candles.length < period + 1) {
      return;
    }

    let atrSum = 0;
    for (let i = this.candles.length - period; i < this.candles.length; i++) {
      const candle = this.candles[i];
      const prevCandle = this.candles[i - 1];
      
      const tr1 = candle.high - candle.low;
      const tr2 = Math.abs(candle.high - prevCandle.close);
      const tr3 = Math.abs(candle.low - prevCandle.close);
      
      atrSum += Math.max(tr1, tr2, tr3);
    }

    this.lastAtr = atrSum / period;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SWING DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  _detectSwingPoints() {
    if (this.candles.length < this.swingLength * 2 + 1) {
      return;
    }

    // Check for swings in the lookback window
    const startIdx = this.swingLength;
    const endIdx = this.candles.length - this.swingLength;

    for (let i = startIdx; i < endIdx; i++) {
      // Skip if we already have this swing
      if (this.swingPoints.some(s => s.index === i)) {
        continue;
      }

      const candle = this.candles[i];
      
      // Get surrounding candles
      const leftCandles = this.candles.slice(i - this.swingLength, i);
      const rightCandles = this.candles.slice(i + 1, i + this.swingLength + 1);

      // Check for swing high
      const leftMaxHigh = Math.max(...leftCandles.map(c => c.high));
      const rightMaxHigh = Math.max(...rightCandles.map(c => c.high));
      
      if (candle.high > leftMaxHigh && candle.high > rightMaxHigh) {
        this._addSwingPoint(i, candle.high, 'high', candle.timestamp);
      }

      // Check for swing low
      const leftMinLow = Math.min(...leftCandles.map(c => c.low));
      const rightMinLow = Math.min(...rightCandles.map(c => c.low));
      
      if (candle.low < leftMinLow && candle.low < rightMinLow) {
        this._addSwingPoint(i, candle.low, 'low', candle.timestamp);
      }
    }

    // Sort and label swing points
    this.swingPoints.sort((a, b) => a.index - b.index);
    this._labelSwingPoints();
  }

  _addSwingPoint(index, price, type, timestamp) {
    this.swingPoints.push({
      index,
      price,
      type,
      label: null,
      timestamp
    });

    // Keep limited history
    if (this.swingPoints.length > 50) {
      this.swingPoints = this.swingPoints.slice(-50);
    }
  }

  _labelSwingPoints() {
    let lastHigh = null;
    let lastLow = null;

    for (const point of this.swingPoints) {
      if (point.type === 'high') {
        if (!lastHigh) {
          point.label = SwingType.HIGHER_HIGH;
        } else if (point.price > lastHigh.price) {
          point.label = SwingType.HIGHER_HIGH;
        } else {
          point.label = SwingType.LOWER_HIGH;
        }
        lastHigh = point;
      } else {
        if (!lastLow) {
          point.label = SwingType.HIGHER_LOW;
        } else if (point.price > lastLow.price) {
          point.label = SwingType.HIGHER_LOW;
        } else {
          point.label = SwingType.LOWER_LOW;
        }
        lastLow = point;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ZONE DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  _updateZones() {
    if (!this.lastAtr || this.swingPoints.length === 0) {
      return;
    }

    const zoneHeight = this.lastAtr * this.zoneAtrMultiplier;

    for (const point of this.swingPoints) {
      if (point.type === 'high') {
        // Supply zone below swing high
        const zone = {
          top: point.price,
          bottom: point.price - zoneHeight,
          type: 'supply',
          strength: this._calculateZoneStrength(point),
          isBroken: false,
          createdAt: point.timestamp
        };

        if (!this._zoneOverlaps(zone, this.supplyZones)) {
          this.supplyZones.push(zone);
          if (this.supplyZones.length > this.maxZones) {
            this.supplyZones.shift();
          }
        }
      } else {
        // Demand zone above swing low
        const zone = {
          top: point.price + zoneHeight,
          bottom: point.price,
          type: 'demand',
          strength: this._calculateZoneStrength(point),
          isBroken: false,
          createdAt: point.timestamp
        };

        if (!this._zoneOverlaps(zone, this.demandZones)) {
          this.demandZones.push(zone);
          if (this.demandZones.length > this.maxZones) {
            this.demandZones.shift();
          }
        }
      }
    }
  }

  _calculateZoneStrength(point) {
    // Trend continuation swings are stronger
    if (point.label === SwingType.HIGHER_HIGH || point.label === SwingType.LOWER_LOW) {
      return 5;
    }
    return 3;
  }

  _zoneOverlaps(newZone, existingZones) {
    for (const zone of existingZones) {
      const overlap = Math.min(newZone.top, zone.top) - Math.max(newZone.bottom, zone.bottom);
      if (overlap > 0) {
        const zoneHeight = newZone.top - newZone.bottom;
        if (overlap / zoneHeight > 0.5) {
          return true;
        }
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STRUCTURE BREAK DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  _detectStructureBreaks(currentPrice) {
    // Check supply zone breaks (bullish)
    for (const zone of this.supplyZones) {
      if (!zone.isBroken && currentPrice > zone.top) {
        zone.isBroken = true;
        this.structureBreaks.push({
          type: 'bos',
          direction: 'bullish',
          price: currentPrice,
          timestamp: Date.now()
        });
      }
    }

    // Check demand zone breaks (bearish)
    for (const zone of this.demandZones) {
      if (!zone.isBroken && currentPrice < zone.bottom) {
        zone.isBroken = true;
        this.structureBreaks.push({
          type: 'bos',
          direction: 'bearish',
          price: currentPrice,
          timestamp: Date.now()
        });
      }
    }

    // Keep limited history
    if (this.structureBreaks.length > 20) {
      this.structureBreaks = this.structureBreaks.slice(-20);
    }

    // Remove broken zones
    this.supplyZones = this.supplyZones.filter(z => !z.isBroken);
    this.demandZones = this.demandZones.filter(z => !z.isBroken);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TREND DETERMINATION
  // ═══════════════════════════════════════════════════════════════════════════

  _updateTrend() {
    if (this.swingPoints.length < 4) {
      this.currentTrend = TrendDirection.RANGING;
      return;
    }

    const recentSwings = this.swingPoints.slice(-6);
    
    let bullishCount = 0;
    let bearishCount = 0;

    for (const swing of recentSwings) {
      if (swing.label === SwingType.HIGHER_HIGH || swing.label === SwingType.HIGHER_LOW) {
        bullishCount++;
      }
      if (swing.label === SwingType.LOWER_HIGH || swing.label === SwingType.LOWER_LOW) {
        bearishCount++;
      }
    }

    if (bullishCount >= 4 && bullishCount > bearishCount) {
      this.currentTrend = TrendDirection.BULLISH;
    } else if (bearishCount >= 4 && bearishCount > bullishCount) {
      this.currentTrend = TrendDirection.BEARISH;
    } else {
      this.currentTrend = TrendDirection.RANGING;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FEATURE EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get market structure features for strategy evaluation
   * @param {number} currentPrice - Current market price
   * @returns {Object} Feature values
   */
  getFeatures(currentPrice) {
    const lastSwingHigh = this.swingPoints.filter(s => s.type === 'high').slice(-1)[0];
    const lastSwingLow = this.swingPoints.filter(s => s.type === 'low').slice(-1)[0];

    // Check if price is in any zone
    const inDemandZone = this.demandZones.some(z => 
      currentPrice >= z.bottom && currentPrice <= z.top
    );
    const inSupplyZone = this.supplyZones.some(z => 
      currentPrice >= z.bottom && currentPrice <= z.top
    );

    // Recent structure breaks (last 5 bars worth)
    const recentBreaks = this.structureBreaks.slice(-5);
    const bosBullish = recentBreaks.some(b => b.direction === 'bullish');
    const bosBearish = recentBreaks.some(b => b.direction === 'bearish');

    // Distance to nearest zones (in ATR units)
    let nearestDemandDist = null;
    let nearestSupplyDist = null;

    if (this.lastAtr && this.demandZones.length > 0) {
      const belowZones = this.demandZones.filter(z => z.top < currentPrice);
      if (belowZones.length > 0) {
        const nearest = belowZones.reduce((a, b) => 
          (currentPrice - a.top) < (currentPrice - b.top) ? a : b
        );
        nearestDemandDist = (currentPrice - nearest.top) / this.lastAtr;
      }
    }

    if (this.lastAtr && this.supplyZones.length > 0) {
      const aboveZones = this.supplyZones.filter(z => z.bottom > currentPrice);
      if (aboveZones.length > 0) {
        const nearest = aboveZones.reduce((a, b) => 
          (a.bottom - currentPrice) < (b.bottom - currentPrice) ? a : b
        );
        nearestSupplyDist = (nearest.bottom - currentPrice) / this.lastAtr;
      }
    }

    return {
      // Trend
      ms_trend: this.currentTrend,
      ms_trend_bullish: this.currentTrend === TrendDirection.BULLISH,
      ms_trend_bearish: this.currentTrend === TrendDirection.BEARISH,

      // Zone presence
      ms_in_demand_zone: inDemandZone,
      ms_in_supply_zone: inSupplyZone,
      ms_active_demand_zones: this.demandZones.length,
      ms_active_supply_zones: this.supplyZones.length,

      // Zone distances
      ms_nearest_demand_dist_atr: nearestDemandDist,
      ms_nearest_supply_dist_atr: nearestSupplyDist,

      // Structure breaks
      ms_bos_bullish: bosBullish,
      ms_bos_bearish: bosBearish,

      // Swing types
      ms_hh: lastSwingHigh?.label === SwingType.HIGHER_HIGH,
      ms_lh: lastSwingHigh?.label === SwingType.LOWER_HIGH,
      ms_hl: lastSwingLow?.label === SwingType.HIGHER_LOW,
      ms_ll: lastSwingLow?.label === SwingType.LOWER_LOW,

      // Swing prices
      ms_swing_high: lastSwingHigh?.price || null,
      ms_swing_low: lastSwingLow?.price || null,

      // ATR
      atr_14: this.lastAtr
    };
  }

  /**
   * Get current state summary
   * @returns {Object}
   */
  getState() {
    return {
      trend: this.currentTrend,
      swingPoints: this.swingPoints.length,
      supplyZones: this.supplyZones.length,
      demandZones: this.demandZones.length,
      recentBreaks: this.structureBreaks.slice(-5)
    };
  }
}

module.exports = {
  MarketStructureAnalyzer,
  SwingType,
  TrendDirection
};

