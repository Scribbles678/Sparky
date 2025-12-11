# CCXT Exchange Integration - UI Proposal

**Date:** December 2025  
**Goal:** Enable users to add API keys for any CCXT-supported exchange (100+ exchanges) through SignalStudio UI

---

## Current State Analysis

### ✅ What Works Now

1. **Exchange Accounts Page** (`exchange-accounts.vue`)
   - Dynamic credential forms
   - Exchange cards with balance display
   - "Add Exchange" sheet with search
   - Connection testing
   - Exchange limit enforcement

2. **API Endpoint** (`/api/bot/credentials`)
   - CRUD operations for credentials
   - Exchange limit checking
   - User isolation (RLS)

3. **Database Schema** (`bot_credentials`)
   - Flexible `extra_metadata` JSONB field
   - Supports: `api_key`, `api_secret`, `passphrase`, `account_id`

### ❌ Current Limitations

1. **Hardcoded Exchange List**
   - Only 8 exchanges in `availableExchanges` array
   - Manual config for each exchange in `exchangeConfigs`
   - No way to add new exchanges without code changes

2. **Static Exchange Metadata**
   - Logos, icons, instructions hardcoded
   - Asset class/types manually defined
   - No dynamic discovery

3. **No CCXT Integration**
   - Can't leverage CCXT's 100+ supported exchanges
   - No way to query CCXT for exchange capabilities

---

## Proposed Solution

### Phase 1: CCXT Exchange Discovery API

**Create:** `SignalStudio/server/api/exchanges/ccxt.ts`

```typescript
import { defineEventHandler } from 'h3'
import ccxt from 'ccxt'

export default defineEventHandler(async () => {
  // Get all CCXT-supported exchanges
  const exchangeIds = ccxt.exchanges
  
  // Fetch metadata for each exchange
  const exchanges = exchangeIds.map(id => {
    try {
      // Create instance to get metadata (no API keys needed)
      const ExchangeClass = ccxt[id]
      if (!ExchangeClass) return null
      
      const exchange = new ExchangeClass()
      
      return {
        id: id,
        name: exchange.name || id,
        // Determine asset types from exchange capabilities
        assetTypes: determineAssetTypes(exchange),
        // Determine if it's CEX or DEX
        type: exchange.urls?.www ? 'CEX' : 'DEX',
        // Check if passphrase required (Coinbase, etc.)
        requiresPassphrase: checkRequiresPassphrase(exchange),
        // Check if accountId required (OANDA, Tradier, etc.)
        requiresAccountId: checkRequiresAccountId(exchange),
        // Get logo URL (if available)
        logo: getExchangeLogo(id),
        // Default instructions
        instructions: getDefaultInstructions(id),
        // Color class for UI
        colorClass: getColorClass(id)
      }
    } catch (e) {
      return null
    }
  }).filter(Boolean)
  
  return { exchanges }
})

function determineAssetTypes(exchange: any): string {
  const types = []
  if (exchange.has?.fetchTicker) types.push('Spot')
  if (exchange.has?.fetchPositions) types.push('Futures')
  if (exchange.has?.fetchOptionChain) types.push('Options')
  return types.join(' • ') || 'Crypto'
}

function checkRequiresPassphrase(exchange: any): boolean {
  // Known exchanges that require passphrase
  const passphraseExchanges = ['coinbase', 'coinbasepro', 'kucoin']
  return passphraseExchanges.includes(exchange.id)
}

function checkRequiresAccountId(exchange: any): boolean {
  // Known exchanges that require account ID
  const accountIdExchanges = ['oanda', 'tradier']
  return accountIdExchanges.includes(exchange.id)
}
```

**Benefits:**
- ✅ Dynamically discovers all CCXT exchanges
- ✅ No code changes needed when CCXT adds new exchanges
- ✅ Returns exchange capabilities automatically

---

### Phase 2: Enhanced Exchange Metadata

**Create:** `SignalStudio/server/api/exchanges/metadata.ts`

```typescript
// Exchange metadata cache (can be stored in DB or JSON file)
const exchangeMetadata = {
  'apex': {
    name: 'Apex',
    logo: '/logos/apex.png',
    instructions: 'To obtain API keys, login to Apex and navigate to API Management.',
    colorClass: 'bg-blue-500/20 text-blue-500',
    assetTypes: 'Crypto • Futures',
    requiresPassphrase: false,
    requiresAccountId: false
  },
  // ... more exchanges
  // Fallback for unknown exchanges
  _default: {
    instructions: 'To obtain API keys, login to your exchange account and navigate to API Management.',
    colorClass: 'bg-gray-500/20 text-gray-500',
    assetTypes: 'Crypto'
  }
}
```

**Alternative:** Store in Supabase table `exchange_metadata` for easier updates.

---

### Phase 3: Update Exchange Accounts UI

**Modify:** `exchange-accounts.vue`

#### 3.1 Load CCXT Exchanges Dynamically

```typescript
// Replace hardcoded availableExchanges
const availableExchanges = ref<AvailableExchange[]>([])

async function loadCCXTExchanges() {
  try {
    const response = await $fetch<{ exchanges: any[] }>('/api/exchanges/ccxt')
    
    // Merge with metadata
    availableExchanges.value = response.exchanges.map(exchange => ({
      id: exchange.id,
      name: exchange.name,
      icon: getExchangeIcon(exchange.id),
      logo: exchange.logo || getDefaultLogo(exchange.id),
      assetClass: exchange.type === 'DEX' ? 'DEX' : 'CEX',
      assetTypes: exchange.assetTypes,
      marketHours: '24/7 Trading', // Default, can be enhanced
      colorClass: exchange.colorClass || 'bg-gray-500/20 text-gray-500',
      isConnected: false,
      instructions: exchange.instructions,
      requiresPassphrase: exchange.requiresPassphrase,
      requiresAccountId: exchange.requiresAccountId
    }))
  } catch (error) {
    console.error('Failed to load CCXT exchanges:', error)
    // Fallback to hardcoded list
    availableExchanges.value = getDefaultExchanges()
  }
}
```

#### 3.2 Dynamic Credential Form Fields

```vue
<!-- Update credential form to show/hide fields based on exchange requirements -->
<div v-if="selectedExchange?.requiresAccountId" class="space-y-2">
  <Label>Account ID</Label>
  <Input v-model="credentialForms[card.key].accountId" />
</div>

<div v-if="selectedExchange?.requiresPassphrase" class="space-y-2">
  <Label>Passphrase</Label>
  <Input v-model="credentialForms[card.key].passphrase" type="password" />
</div>
```

#### 3.3 Enhanced Search & Filtering

```typescript
const filteredExchanges = computed(() => {
  if (!exchangeSearch.value) return availableExchanges.value
  
  const search = exchangeSearch.value.toLowerCase()
  return availableExchanges.value.filter(exchange =>
    exchange.name.toLowerCase().includes(search) ||
    exchange.assetTypes.toLowerCase().includes(search) ||
    exchange.id.toLowerCase().includes(search) ||
    (exchange.type === 'DEX' && 'dex'.includes(search)) ||
    (exchange.type === 'CEX' && 'cex'.includes(search))
  )
})
```

---

### Phase 4: Exchange-Specific Balance Endpoints

**Current:** Each exchange has its own balance endpoint (`/api/balance/aster`, `/api/balance/oanda`, etc.)

**Proposed:** Generic CCXT balance endpoint

**Create:** `SignalStudio/server/api/balance/ccxt/[exchange].ts`

```typescript
import { defineEventHandler, getRouterParam } from 'h3'
import { useServiceSupabaseClient } from '~/utils/supabase'
import ccxt from 'ccxt'

export default defineEventHandler(async (event) => {
  const exchangeId = getRouterParam(event, 'exchange')
  const user = event.context.user
  
  if (!exchangeId || !user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  
  // Load user's credentials
  const supabase = useServiceSupabaseClient()
  const { data: credential } = await supabase
    .from('bot_credentials')
    .select('*')
    .eq('user_id', user.id)
    .eq('exchange', exchangeId)
    .eq('environment', 'production')
    .maybeSingle()
  
  if (!credential) {
    throw createError({ statusCode: 404, statusMessage: 'Credentials not found' })
  }
  
  try {
    // Create CCXT exchange instance
    const ExchangeClass = ccxt[exchangeId]
    if (!ExchangeClass) {
      throw createError({ statusCode: 400, statusMessage: `Exchange ${exchangeId} not supported` })
    }
    
    const exchange = new ExchangeClass({
      apiKey: credential.api_key,
      secret: credential.api_secret,
      passphrase: credential.passphrase,
      // Add any extra config from extra_metadata
      ...credential.extra_metadata
    })
    
    // Fetch balance
    await exchange.loadMarkets()
    const balance = await exchange.fetchBalance()
    
    // Normalize balance response
    return {
      success: true,
      exchange: exchangeId,
      balance: balance.USDT?.total || balance.USD?.total || 0,
      availableBalance: balance.USDT?.free || balance.USD?.free || 0
    }
  } catch (error: any) {
    return {
      success: false,
      exchange: exchangeId,
      error: error.message || 'Failed to fetch balance'
    }
  }
})
```

**Update:** `exchange-accounts.vue` to use generic endpoint

```typescript
// In loadBalances(), check if exchange is CCXT-based
const balancePromise = isCCXTExchange(exchangeId)
  ? $fetch(`/api/balance/ccxt/${exchangeId}`)
  : $fetch(`/api/balance/${exchangeId}`)
```

---

### Phase 5: Exchange Capability Detection

**Enhance:** Exchange metadata to include capabilities

```typescript
interface ExchangeCapabilities {
  supportsSpot: boolean
  supportsFutures: boolean
  supportsOptions: boolean
  supportsMargin: boolean
  requiresPassphrase: boolean
  requiresAccountId: boolean
  supportedMarkets: string[] // ['spot', 'futures', 'options']
}
```

**Use Case:** Show/hide features in UI based on exchange capabilities.

---

## Implementation Plan

### Step 1: Backend API (SignalStudio)
1. ✅ Install `ccxt` in SignalStudio
2. ✅ Create `/api/exchanges/ccxt.ts` endpoint
3. ✅ Create `/api/exchanges/metadata.ts` (optional, can use hardcoded)
4. ✅ Create `/api/balance/ccxt/[exchange].ts` endpoint
5. ✅ Test with Apex exchange

### Step 2: Frontend UI (SignalStudio)
1. ✅ Update `exchange-accounts.vue` to load CCXT exchanges
2. ✅ Add dynamic credential form fields
3. ✅ Enhance search/filtering
4. ✅ Update balance loading logic
5. ✅ Add exchange capability badges

### Step 3: Testing
1. ✅ Test with Apex (DEX)
2. ✅ Test with Binance (CEX)
3. ✅ Test with Coinbase (requires passphrase)
4. ✅ Test exchange limit enforcement
5. ✅ Test balance fetching

### Step 4: Documentation
1. ✅ Update user guide
2. ✅ Add exchange-specific instructions
3. ✅ Document CCXT integration

---

## Database Considerations

### Option A: No Schema Changes (Recommended)
- Use existing `bot_credentials` table
- Store exchange-specific fields in `extra_metadata` JSONB
- Works for all CCXT exchanges

### Option B: Exchange Metadata Table (Optional)
```sql
CREATE TABLE exchange_metadata (
  exchange_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  instructions TEXT,
  color_class TEXT,
  asset_types TEXT[],
  requires_passphrase BOOLEAN DEFAULT FALSE,
  requires_account_id BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Benefits:**
- Easy to update exchange metadata
- Can be managed via admin UI
- Supports custom instructions per exchange

---

## UI/UX Enhancements

### 1. Exchange Categories
- **Crypto CEX** (Binance, Coinbase, etc.)
- **Crypto DEX** (Apex, Hyperliquid, etc.)
- **Forex** (OANDA, etc.)
- **Stocks** (Tradier, Alpaca, etc.)

### 2. Exchange Badges
- ✅ **CCXT Certified** (for verified exchanges)
- 🔒 **DEX** (for decentralized exchanges)
- 🌍 **Global** (for international exchanges)

### 3. Search Improvements
- Search by name, asset type, or exchange ID
- Filter by category (CEX/DEX)
- Sort by popularity or alphabetically

### 4. Connection Status
- Show last tested timestamp
- Display connection errors clearly
- Auto-retry failed connections

---

## Security Considerations

1. **Credential Validation**
   - Test API keys before saving
   - Validate exchange-specific requirements
   - Show clear error messages

2. **Rate Limiting**
   - Limit balance fetch requests
   - Cache exchange metadata
   - Throttle CCXT API calls

3. **Error Handling**
   - Graceful fallback if CCXT fails
   - Clear error messages for users
   - Log errors for debugging

---

## Migration Path

### For Existing Users
1. ✅ Existing credentials continue to work
2. ✅ Hardcoded exchanges remain as fallback
3. ✅ New CCXT exchanges appear in "Add Exchange" sheet
4. ✅ No breaking changes

### For New Exchanges
1. ✅ User selects exchange from CCXT list
2. ✅ Enters API credentials
3. ✅ System validates and saves
4. ✅ Exchange appears in exchange cards

---

## Estimated Effort

- **Backend API:** 4-6 hours
- **Frontend UI:** 6-8 hours
- **Testing:** 2-4 hours
- **Documentation:** 1-2 hours

**Total:** ~13-20 hours

---

## Next Steps

1. **Review this proposal** - Confirm approach
2. **Install CCXT in SignalStudio** - `npm install ccxt`
3. **Create CCXT exchange discovery API** - Start with Phase 1
4. **Test with Apex** - Verify end-to-end flow
5. **Iterate based on feedback** - Refine UI/UX

---

## Questions to Consider

1. **Exchange Metadata Storage:** Hardcoded vs Database?
2. **Logo Management:** CDN vs Local storage?
3. **Exchange Instructions:** Generic vs Exchange-specific?
4. **Balance Endpoint:** Generic CCXT vs Exchange-specific?
5. **Error Handling:** How detailed should error messages be?

---

## Success Criteria

✅ Users can add any CCXT-supported exchange  
✅ Exchange list updates automatically when CCXT adds exchanges  
✅ Credential forms adapt to exchange requirements  
✅ Balance fetching works for all CCXT exchanges  
✅ No breaking changes for existing users  
✅ UI remains clean and intuitive with 100+ exchanges  

