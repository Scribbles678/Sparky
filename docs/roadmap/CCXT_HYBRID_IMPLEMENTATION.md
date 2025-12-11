# CCXT Hybrid Implementation Plan

**Date:** December 2025  
**Approach:** CCXT (crypto) + Hardcoded (equities/forex) exchanges

---

## Architecture Overview

### Exchange Categories

1. **CCXT Exchanges** (Dynamic - 100+ crypto exchanges)
   - Loaded from CCXT library
   - Examples: Binance, Coinbase, Apex, Hyperliquid
   - Cached in Redis

2. **Hardcoded Exchanges** (Equities, Forex, Custom)
   - Manually maintained list
   - Examples: OANDA, Tradier, Aster, Lighter
   - Custom integrations

### Unified Exchange List

Both types appear in the same "Add Exchange" sheet, with clear categorization.

---

## Implementation Plan

### Phase 1: Exchange Metadata Structure

**Create:** `server/utils/exchangeMetadata.ts`

```typescript
/**
 * Hardcoded Exchange Metadata
 * 
 * These are exchanges that:
 * - Are NOT in CCXT (equities, forex, custom)
 * - Have custom integrations in Sparky
 * - Need manual configuration
 */

export interface ExchangeMetadata {
  id: string
  name: string
  icon: string
  logo?: string
  assetClass: 'Crypto' | 'Forex' | 'Stocks' | 'Options' | 'Futures' | 'Multi-Asset'
  assetTypes: string
  marketHours: string
  colorClass: string
  instructions?: string
  ipWhitelist?: string
  requiresPassphrase: boolean
  requiresAccountId: boolean
  isCCXT: boolean // false for hardcoded
  isCustom: boolean // true for custom integrations
}

/**
 * Hardcoded exchanges (non-CCXT)
 */
export const HARDCODED_EXCHANGES: ExchangeMetadata[] = [
  {
    id: 'aster',
    name: 'Aster',
    icon: 'i-simple-icons-bitcoin',
    logo: '/aster_logo.png',
    assetClass: 'Crypto',
    assetTypes: 'Crypto Futures',
    marketHours: '24/7 Trading',
    colorClass: 'bg-orange-500/20 text-orange-500',
    instructions: 'To obtain API keys, login to your Aster account and navigate to API Management.',
    requiresPassphrase: false,
    requiresAccountId: false,
    isCCXT: false,
    isCustom: true
  },
  {
    id: 'oanda',
    name: 'OANDA',
    icon: 'i-heroicons-currency-dollar',
    logo: '/oanda_logo.png',
    assetClass: 'Forex',
    assetTypes: 'Forex',
    marketHours: '24/5 Trading',
    colorClass: 'bg-green-500/20 text-green-500',
    instructions: 'To obtain API keys, login to your OANDA account and navigate to Manage API Access.',
    requiresPassphrase: false,
    requiresAccountId: true, // OANDA requires account ID
    isCCXT: false,
    isCustom: true
  },
  {
    id: 'tradier',
    name: 'Tradier',
    icon: 'i-heroicons-chart-bar',
    logo: '/tradier_logo.png',
    assetClass: 'Stocks',
    assetTypes: 'Stocks • Options',
    marketHours: 'Market Hours',
    colorClass: 'bg-blue-500/20 text-blue-500',
    instructions: 'To obtain API keys, login to your Tradier account and navigate to Settings > API Access.',
    requiresPassphrase: false,
    requiresAccountId: true, // Tradier requires account ID
    isCCXT: false,
    isCustom: true
  },
  {
    id: 'tradier_options',
    name: 'Tradier Options',
    icon: 'i-heroicons-chart-bar',
    logo: '/tradier_logo.png',
    assetClass: 'Options',
    assetTypes: 'Options',
    marketHours: 'Market Hours',
    colorClass: 'bg-blue-500/20 text-blue-500',
    instructions: 'Uses same credentials as Tradier.',
    requiresPassphrase: false,
    requiresAccountId: true,
    isCCXT: false,
    isCustom: true
  },
  {
    id: 'lighter',
    name: 'Lighter DEX',
    icon: 'i-simple-icons-bitcoin',
    logo: '/lighter_logo.png',
    assetClass: 'Crypto',
    assetTypes: 'Crypto Perps (zkSync)',
    marketHours: '24/7 Trading',
    colorClass: 'bg-purple-500/20 text-purple-500',
    instructions: 'To obtain API keys, login to your Lighter account and navigate to API Management.',
    requiresPassphrase: false,
    requiresAccountId: false,
    isCCXT: false,
    isCustom: true
  },
  {
    id: 'hyperliquid',
    name: 'Hyperliquid',
    icon: 'i-simple-icons-bitcoin',
    logo: '/hyperliquid_logo.png',
    assetClass: 'Crypto',
    assetTypes: 'Crypto Perps',
    marketHours: '24/7 Trading',
    colorClass: 'bg-cyan-500/20 text-cyan-500',
    instructions: 'To obtain API keys, login to your Hyperliquid account and navigate to API Management.',
    requiresPassphrase: false,
    requiresAccountId: false,
    isCCXT: false,
    isCustom: true
  },
  {
    id: 'tastytrade',
    name: 'Tasty Trade',
    icon: 'i-heroicons-chart-line',
    logo: '/tastytrade_logo.jpg',
    assetClass: 'Futures',
    assetTypes: 'Futures • Options',
    marketHours: 'Extended Hours',
    colorClass: 'bg-indigo-500/20 text-indigo-500',
    instructions: 'To obtain API keys, login to your TastyTrade account and navigate to My Account > API Access.',
    requiresPassphrase: true,
    requiresAccountId: true,
    isCCXT: false,
    isCustom: true
  }
]

/**
 * Get hardcoded exchange by ID
 */
export function getHardcodedExchange(id: string): ExchangeMetadata | undefined {
  return HARDCODED_EXCHANGES.find(e => e.id === id)
}

/**
 * Check if exchange is hardcoded (non-CCXT)
 */
export function isHardcodedExchange(id: string): boolean {
  return HARDCODED_EXCHANGES.some(e => e.id === id)
}
```

---

### Phase 2: CCXT Exchange Discovery API

**Create:** `server/api/exchanges/ccxt.ts`

```typescript
import { defineEventHandler } from 'h3'
import { getOrSetCache } from '~/server/utils/redis'

export default defineEventHandler(async () => {
  // Cache CCXT exchange list for 1 hour (rarely changes)
  return await getOrSetCache(
    'ccxt:exchanges:metadata',
    async () => {
      // Lazy import CCXT (only on cache miss)
      const ccxt = await import('ccxt')
      
      const exchanges = ccxt.exchanges.map(id => {
        try {
          const ExchangeClass = ccxt[id]
          if (!ExchangeClass) return null
          
          // Create instance without API keys (just for metadata)
          const exchange = new ExchangeClass()
          
          return {
            id: id.toLowerCase(),
            name: exchange.name || id,
            icon: getCCXTIcon(id),
            logo: getCCXTLogo(id),
            assetClass: exchange.urls?.www ? 'Crypto' : 'Crypto', // Most CCXT are crypto
            assetTypes: determineAssetTypes(exchange),
            marketHours: '24/7 Trading', // Default for crypto
            colorClass: getCCXTColorClass(id),
            instructions: getDefaultCCXTInstructions(id),
            requiresPassphrase: checkRequiresPassphrase(id),
            requiresAccountId: false, // Most CCXT don't need account ID
            isCCXT: true,
            isCustom: false
          }
        } catch (e) {
          return null
        }
      }).filter(Boolean)
      
      return { exchanges }
    },
    3600 // 1 hour TTL
  )
})

function determineAssetTypes(exchange: any): string {
  const types = []
  if (exchange.has?.fetchTicker) types.push('Spot')
  if (exchange.has?.fetchPositions) types.push('Futures')
  if (exchange.has?.fetchOptionChain) types.push('Options')
  return types.join(' • ') || 'Crypto'
}

function checkRequiresPassphrase(id: string): boolean {
  const passphraseExchanges = ['coinbase', 'coinbasepro', 'kucoin']
  return passphraseExchanges.includes(id.toLowerCase())
}

function getCCXTIcon(id: string): string {
  // Default icon for CCXT exchanges
  return 'i-simple-icons-bitcoin'
}

function getCCXTLogo(id: string): string | undefined {
  // Return logo URL if available, otherwise undefined
  return undefined // Can be enhanced later
}

function getCCXTColorClass(id: string): string {
  // Default color for CCXT exchanges
  return 'bg-gray-500/20 text-gray-500'
}

function getDefaultCCXTInstructions(id: string): string {
  return `To obtain API keys, login to your ${id} account and navigate to API Management or Settings > API.`
}
```

---

### Phase 3: Unified Exchange List API

**Create:** `server/api/exchanges/list.ts`

```typescript
import { defineEventHandler } from 'h3'
import { HARDCODED_EXCHANGES } from '~/server/utils/exchangeMetadata'

export default defineEventHandler(async () => {
  // Get CCXT exchanges (cached)
  let ccxtExchanges: any[] = []
  try {
    const ccxtResponse = await $fetch('/api/exchanges/ccxt')
    ccxtExchanges = ccxtResponse.exchanges || []
  } catch (error) {
    console.error('Failed to load CCXT exchanges:', error)
    // Continue with hardcoded exchanges only
  }
  
  // Merge hardcoded + CCXT exchanges
  // Hardcoded exchanges take precedence (if same ID exists in both)
  const allExchanges = [
    ...HARDCODED_EXCHANGES,
    ...ccxtExchanges.filter(ccxt => 
      !HARDCODED_EXCHANGES.some(hard => hard.id === ccxt.id)
    )
  ]
  
  // Sort by name
  allExchanges.sort((a, b) => a.name.localeCompare(b.name))
  
  return {
    exchanges: allExchanges,
    stats: {
      total: allExchanges.length,
      hardcoded: HARDCODED_EXCHANGES.length,
      ccxt: ccxtExchanges.length
    }
  }
})
```

---

### Phase 4: Balance Endpoint Router

**Update:** Balance fetching logic to route to correct endpoint

**Option A: Smart Router** (Recommended)

**Create:** `server/api/balance/[exchange].ts`

```typescript
import { defineEventHandler, getRouterParam } from 'h3'
import { isHardcodedExchange } from '~/server/utils/exchangeMetadata'

export default defineEventHandler(async (event) => {
  const exchangeId = getRouterParam(event, 'exchange')
  
  if (!exchangeId) {
    throw createError({ statusCode: 400, statusMessage: 'Exchange ID required' })
  }
  
  // Route to appropriate endpoint
  if (isHardcodedExchange(exchangeId)) {
    // Use existing hardcoded balance endpoint
    return await $fetch(`/api/balance/${exchangeId}`)
  } else {
    // Use CCXT balance endpoint
    return await $fetch(`/api/balance/ccxt/${exchangeId}`)
  }
})
```

**Option B: Keep Separate Endpoints** (Simpler)

- Keep existing: `/api/balance/aster`, `/api/balance/oanda`, etc.
- Add new: `/api/balance/ccxt/[exchange]`
- Frontend checks if exchange is CCXT or hardcoded

---

### Phase 5: Update Frontend

**Update:** `app/pages/account/exchange-accounts.vue`

#### 5.1 Load Unified Exchange List

```typescript
// Replace hardcoded availableExchanges
const availableExchanges = ref<AvailableExchange[]>([])

async function loadAllExchanges() {
  try {
    const response = await $fetch<{ exchanges: any[], stats: any }>('/api/exchanges/list')
    
    availableExchanges.value = response.exchanges.map(exchange => ({
      id: exchange.id,
      name: exchange.name,
      icon: exchange.icon,
      logo: exchange.logo,
      assetClass: exchange.assetClass,
      assetTypes: exchange.assetTypes,
      marketHours: exchange.marketHours,
      colorClass: exchange.colorClass,
      isConnected: false,
      instructions: exchange.instructions,
      requiresPassphrase: exchange.requiresPassphrase,
      requiresAccountId: exchange.requiresAccountId,
      isCCXT: exchange.isCCXT,
      isCustom: exchange.isCustom
    }))
  } catch (error) {
    console.error('Failed to load exchanges:', error)
    // Fallback to hardcoded only
    availableExchanges.value = HARDCODED_EXCHANGES.map(e => ({
      id: e.id,
      name: e.name,
      // ... map other fields
    }))
  }
}
```

#### 5.2 Update Balance Loading

```typescript
async function loadBalances() {
  // ... existing code ...
  
  const balancePromises = validExchanges.map(async (exchangeId) => {
    try {
      // Check if hardcoded or CCXT
      const isHardcoded = isHardcodedExchange(exchangeId)
      const endpoint = isHardcoded
        ? `/api/balance/${exchangeId}`
        : `/api/balance/ccxt/${exchangeId}`
      
      const balance = await $fetch(endpoint)
      // ... handle response
    } catch (error) {
      // ... handle error
    }
  })
}
```

#### 5.3 Add Exchange Badges

```vue
<!-- In exchange card -->
<Badge v-if="exchange.isCCXT" variant="outline" class="text-xs">
  CCXT
</Badge>
<Badge v-if="exchange.isCustom" variant="outline" class="text-xs">
  Custom
</Badge>
```

---

### Phase 6: CCXT Balance Endpoint

**Create:** `server/api/balance/ccxt/[exchange].ts`

```typescript
import { defineEventHandler, getRouterParam, createError } from 'h3'
import { useServiceSupabaseClient } from '~/utils/supabase'
import { getOrSetCache } from '~/server/utils/redis'

export default defineEventHandler(async (event) => {
  const exchangeId = getRouterParam(event, 'exchange')
  const user = event.context.user
  
  if (!exchangeId || !user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  
  // Load credentials from Supabase
  const supabase = useServiceSupabaseClient()
  const { data: credential } = await supabase
    .from('bot_credentials')
    .select('*')
    .eq('user_id', user.id)
    .eq('exchange', exchangeId)
    .eq('environment', 'production')
    .maybeSingle()
  
  if (!credential) {
    return {
      success: false,
      exchange: exchangeId,
      error: 'Credentials not found'
    }
  }
  
  try {
    // Cache balance for 30 seconds (frequently changing)
    const cacheKey = `ccxt:balance:${user.id}:${exchangeId}`
    
    return await getOrSetCache(
      cacheKey,
      async () => {
        // Lazy import CCXT (only on cache miss)
        const ccxt = await import('ccxt')
        const ExchangeClass = ccxt[exchangeId]
        
        if (!ExchangeClass) {
          throw new Error(`Exchange ${exchangeId} not supported by CCXT`)
        }
        
        const exchange = new ExchangeClass({
          apiKey: credential.api_key,
          secret: credential.api_secret,
          passphrase: credential.passphrase,
          ...credential.extra_metadata
        })
        
        await exchange.loadMarkets()
        const balance = await exchange.fetchBalance()
        
        return {
          success: true,
          exchange: exchangeId,
          balance: balance.USDT?.total || balance.USD?.total || 0,
          availableBalance: balance.USDT?.free || balance.USD?.free || 0
        }
      },
      30 // 30 seconds TTL
    )
  } catch (error: any) {
    return {
      success: false,
      exchange: exchangeId,
      error: error.message || 'Failed to fetch balance'
    }
  }
})
```

---

## Exchange Categories in UI

### Filtering Options

```typescript
const exchangeFilters = {
  all: 'All Exchanges',
  crypto: 'Crypto',
  forex: 'Forex',
  stocks: 'Stocks',
  options: 'Options',
  futures: 'Futures',
  custom: 'Custom Integrations',
  ccxt: 'CCXT Exchanges'
}

const filteredExchanges = computed(() => {
  let filtered = availableExchanges.value
  
  if (selectedFilter.value === 'custom') {
    filtered = filtered.filter(e => e.isCustom)
  } else if (selectedFilter.value === 'ccxt') {
    filtered = filtered.filter(e => e.isCCXT)
  } else if (selectedFilter.value !== 'all') {
    filtered = filtered.filter(e => 
      e.assetClass.toLowerCase() === selectedFilter.value
    )
  }
  
  // Apply search
  if (exchangeSearch.value) {
    const search = exchangeSearch.value.toLowerCase()
    filtered = filtered.filter(e =>
      e.name.toLowerCase().includes(search) ||
      e.id.toLowerCase().includes(search) ||
      e.assetTypes.toLowerCase().includes(search)
    )
  }
  
  return filtered
})
```

---

## Database Considerations

### No Schema Changes Needed ✅

The existing `bot_credentials` table works for both:
- **Hardcoded exchanges:** Stored as-is (e.g., `exchange: 'oanda'`)
- **CCXT exchanges:** Stored with CCXT ID (e.g., `exchange: 'binance'`)

### Extra Metadata Field

Use `extra_metadata` JSONB for exchange-specific config:
```json
{
  "sandbox": true,
  "options": {
    "defaultType": "future"
  }
}
```

---

## Implementation Checklist

### Backend (SignalStudio)
- [ ] Create `server/utils/exchangeMetadata.ts` (hardcoded exchanges)
- [ ] Create `server/api/exchanges/ccxt.ts` (CCXT discovery)
- [ ] Create `server/api/exchanges/list.ts` (unified list)
- [ ] Create `server/api/balance/ccxt/[exchange].ts` (CCXT balance)
- [ ] Install CCXT: `npm install ccxt`
- [ ] Test with Apex exchange

### Frontend (SignalStudio)
- [ ] Update `exchange-accounts.vue` to use unified list
- [ ] Add exchange filtering (CCXT vs Custom)
- [ ] Add exchange badges (CCXT, Custom)
- [ ] Update balance loading logic
- [ ] Test UI with both types

### Testing
- [ ] Test hardcoded exchange (OANDA)
- [ ] Test CCXT exchange (Apex)
- [ ] Test exchange list loading
- [ ] Test balance fetching for both types
- [ ] Test caching (Redis)

---

## Benefits of Hybrid Approach

1. ✅ **Best of Both Worlds**
   - CCXT: 100+ crypto exchanges (dynamic)
   - Hardcoded: Custom integrations (equities, forex)

2. ✅ **Unified UI**
   - Single "Add Exchange" sheet
   - Clear categorization
   - Easy filtering

3. ✅ **Maintainable**
   - Hardcoded exchanges: Easy to update
   - CCXT exchanges: Auto-update with CCXT

4. ✅ **Performance**
   - Redis caching for both types
   - Lazy loading for CCXT
   - Fast response times

---

## Next Steps

1. **Create exchange metadata file** (hardcoded exchanges)
2. **Create CCXT discovery API** (with Redis caching)
3. **Create unified list API** (merge both)
4. **Update frontend** (use unified list)
5. **Test end-to-end** (both types)

Ready to start? 🚀

