<script setup lang="ts">
import { familyPriceRows, familyTrendSeries, type FamilyPurchase, type FamilyTrendPoint } from '../../../shared/utils/product-family'
import { normalizedHistoricalPrice } from '../../../shared/utils/normalized-price'
import { formatMoney } from '../../../shared/utils/currency'

type FamilyData = { families: Array<{ family: string, itemCount: number, purchases: number, totalSpent: string }>, entries: FamilyPurchase[] }
const route = useRoute()
const router = useRouter()
const { apiUrl } = useApi()
const family = computed({
  get: () => typeof route.query.family === 'string' ? route.query.family : '',
  set: value => { router.replace({ query: { family: value } }) }
})
const { data, pending, error, refresh } = await useFetch<FamilyData>(apiUrl('/items/families'), { query: computed(() => ({ family: family.value })) })
watch(() => data.value?.families, (families) => {
  if (!family.value && families?.length) family.value = families[0]!.family
}, { immediate: true })
const basis = ref('all')
const selectedPoint = ref<FamilyTrendPoint | null>(null)
const rows = computed(() => familyPriceRows(data.value?.entries ?? []))
const trendSummaries = computed(() => familyTrendSeries(data.value?.entries ?? []))
const bases = computed(() => [...new Map(rows.value.map(row => [row.basis, { label: row.basisLabel, value: row.basis }])).values()])
const visibleRows = computed(() => rows.value.filter(row => basis.value === 'all' || row.basis === basis.value))
const activeTrend = computed(() => basis.value === 'all'
  ? trendSummaries.value[0] ?? null
  : trendSummaries.value.find(item => item.basis === basis.value) ?? null)
const summary = computed(() => data.value?.families.find(summary => summary.family === family.value))
watch([family, basis], () => { selectedPoint.value = null })
watch(family, () => { basis.value = 'all' })

const variantPalette = ['#295c3b', '#ce9b45', '#2563eb', '#a63e32', '#7c3aed', '#0d9488']
const variantColors = computed(() => {
  const map = new Map<string, string>()
  const points = activeTrend.value?.points ?? []
  for (const point of points) {
    if (!map.has(point.item)) {
      map.set(point.item, variantPalette[map.size % variantPalette.length]!)
    }
  }
  return map
})

const chart = computed(() => {
  const trend = activeTrend.value
  if (!trend || trend.points.length < 2) return null
  const points = trend.points
  const width = 860
  const height = 280
  const plot = { left: 78, right: 24, top: 22, bottom: 44 }
  const values = points.map(point => point.normalizedPrice)
  const timestamps = points.map(point => parseCalendarDate(point.purchasedOn)?.getTime() || 0)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const padding = rawMin === rawMax ? Math.max(rawMax * 0.1, 0.05) : (rawMax - rawMin) * 0.12
  const min = Math.max(0, rawMin - padding)
  const max = rawMax + padding
  const firstTime = Math.min(...timestamps)
  const lastTime = Math.max(...timestamps)
  const xRange = width - plot.left - plot.right
  const yRange = height - plot.top - plot.bottom
  const positioned = points.map((point, index) => ({
    ...point,
    color: variantColors.value.get(point.item) || '#295c3b',
    x: firstTime === lastTime
      ? plot.left + ((index + 0.5) / points.length) * xRange
      : plot.left + ((timestamps[index]! - firstTime) / (lastTime - firstTime)) * xRange,
    y: plot.top + ((max - point.normalizedPrice) / (max - min)) * yRange
  }))
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = max - ((max - min) * index) / 4
    return { value, y: plot.top + (yRange * index) / 4 }
  })
  return {
    width,
    height,
    plot,
    positioned,
    ticks,
    line: positioned.map(point => `${point.x},${point.y}`).join(' ')
  }
})

const visiblePurchases = computed(() => {
  const entries = [...(data.value?.entries ?? [])].sort((a, b) => b.purchasedOn.localeCompare(a.purchasedOn) || b.id.localeCompare(a.id, undefined, { numeric: true }))
  return entries.flatMap((entry) => {
    const normalized = normalizedHistoricalPrice(entry.price, entry.size, entry.unit, entry.costPerUnit)
    const entryBasis = normalized?.basis ?? 'unknown'
    if (basis.value !== 'all' && entryBasis !== basis.value) return []
    return [{
      ...entry,
      basis: entryBasis,
      basisLabel: normalized?.label ?? 'Unknown size/unit',
      normalizedPrice: normalized?.value ?? null
    }]
  })
})

function unitMoney(value: number | null) {
  return value === null ? '-' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)
}

function diffLabel(value: number | null) {
  if (value === null) return '-'
  if (value === 0) return 'Cheapest'
  return `+${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`
}

function signedPercent(value: number | null) {
  if (value === null) return ''
  return `${value > 0 ? '+' : ''}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`
}
</script>

<template>
  <div class="mx-auto grid w-full max-w-350 min-w-0 gap-5 pb-12">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-3xl tracking-normal!">Product families</h1>
        <p class="mt-1 text-sm text-(--muted)">Compare normalized unit prices, brand variants, and price trends across interchangeable items.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton to="/highlights" label="Highlights" icon="i-lucide-sparkles" color="neutral" variant="ghost" />
        <UButton to="/" label="Receipts" icon="i-lucide-arrow-left" color="neutral" variant="outline" />
      </div>
    </header>
    <div class="flex flex-wrap items-center gap-3 border-y border-(--line) py-4">
      <USelectMenu v-model="family" :items="data?.families.map(summary => summary.family) ?? []" placeholder="Choose a family" aria-label="Product family" class="w-full sm:w-72" />
      <USelect v-if="bases.length > 1" v-model="basis" :items="[{ label: 'All price bases', value: 'all' }, ...bases]" aria-label="Price basis" class="w-full sm:w-52" />
      <p v-if="summary" class="text-sm text-(--muted)">{{ summary.itemCount }} products / {{ summary.purchases }} purchases / {{ formatMoney(summary.totalSpent) }} spent</p>
    </div>
    <UAlert v-if="error" title="Could not load product families" color="error"><template #actions><UButton label="Retry" variant="outline" color="neutral" @click="refresh()" /></template></UAlert>
    <p v-else-if="pending" class="py-8 text-center text-(--muted)" role="status">Loading family purchases...</p>
    <p v-else-if="!data?.families.length" class="py-8 text-center text-(--muted)">No product families recorded.</p>
    <p v-else-if="!visibleRows.length" class="py-8 text-center text-(--muted)">No purchases in this family.</p>
    <template v-else>
      <div v-if="activeTrend" class="item-price-stats grid grid-cols-[repeat(3,1fr)] gap-3.5 max-[900.01px]:grid-cols-3 max-[640.01px]:grid-cols-1">
        <UCard>
          <span>Latest family unit price</span>
          <strong>{{ unitMoney(activeTrend.latestPoint.normalizedPrice) }}</strong>
          <small>{{ activeTrend.basisLabel }} · {{ activeTrend.latestPoint.item }}<template v-if="activeTrend.netChangePercent !== null"> ({{ signedPercent(activeTrend.netChangePercent) }} net)</template></small>
        </UCard>
        <UCard>
          <span>Variant price range</span>
          <strong>{{ unitMoney(activeTrend.lowestNormalized) }} – {{ unitMoney(activeTrend.highestNormalized) }}</strong>
          <small>{{ activeTrend.spreadPercent !== null ? `+${activeTrend.spreadPercent}% spread across ${activeTrend.variantCount} variants` : `${activeTrend.variantCount} variant in ${activeTrend.basisLabel}` }}</small>
        </UCard>
        <UCard>
          <span>Family average unit price</span>
          <strong>{{ unitMoney(activeTrend.averageNormalized) }}</strong>
          <small>Across {{ activeTrend.pointCount }} {{ activeTrend.pointCount === 1 ? 'purchase' : 'purchases' }}</small>
        </UCard>
      </div>

      <UCard v-if="chart && activeTrend" class="rounded-[22px] bg-(--surface) shadow-(--shadow) [border:1px_solid_var(--line)]">
        <div class="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="mb-1 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Family price trend</p>
            <h2 class="text-xl">{{ family }} ({{ activeTrend.basisLabel }})</h2>
          </div>
          <div class="flex flex-wrap gap-3 text-xs text-(--muted)">
            <span v-for="[variantName, color] in variantColors" :key="variantName" class="inline-flex items-center gap-1.5">
              <i class="size-2.5 rounded-full" :style="{ backgroundColor: color }" />{{ variantName }}
            </span>
          </div>
        </div>
        <div class="min-w-0 overflow-hidden">
          <svg :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" :aria-label="`${family} family normalized price chart`" class="block h-[280px] w-full">
            <title>{{ family }} family normalized price history</title>
            <g class="chart-grid">
              <g v-for="tick in chart.ticks" :key="tick.y">
                <line :x1="chart.plot.left" :x2="chart.width - chart.plot.right" :y1="tick.y" :y2="tick.y" />
                <text :x="chart.plot.left - 12" :y="tick.y + 4" text-anchor="end">{{ unitMoney(tick.value) }}</text>
              </g>
            </g>
            <polyline class="fill-none stroke-(--accent) stroke-2 opacity-45 [stroke-linecap:round] [stroke-linejoin:round]" :points="chart.line" />
            <g
              v-for="point in chart.positioned"
              :key="point.id"
              class="price-chart-point-group"
              role="button"
              tabindex="0"
              :aria-label="`${point.item}, ${point.purchasedOn}, ${unitMoney(point.normalizedPrice)}, ${point.location}`"
              @click="selectedPoint = point"
              @focus="selectedPoint = point"
              @keydown.enter.prevent="selectedPoint = point"
              @keydown.space.prevent="selectedPoint = point"
            >
              <circle class="price-chart-hit cursor-pointer fill-transparent" :cx="point.x" :cy="point.y" r="14" />
              <circle :cx="point.x" :cy="point.y" r="5.5" :fill="point.color" stroke="var(--surface)" stroke-width="2">
                <title>{{ point.item }} · {{ point.purchasedOn }} · {{ unitMoney(point.normalizedPrice) }} · {{ point.location }}</title>
              </circle>
            </g>
          </svg>
        </div>
        <div v-if="selectedPoint" class="mt-2 flex min-h-11 flex-wrap items-center gap-[7px_14px] rounded-xl p-[10px_13px] text-[13px] [background:var(--surface-muted)] [border:1px_solid_var(--line)]" aria-live="polite">
          <strong>{{ selectedPoint.item }}</strong>
          <span>{{ unitMoney(selectedPoint.normalizedPrice) }} ({{ selectedPoint.basisLabel }})</span>
          <span class="text-(--muted)">{{ formatMoney(selectedPoint.price) }} line total</span>
          <span class="text-(--muted)">{{ selectedPoint.location }} · {{ selectedPoint.purchasedOn }}</span>
          <UBadge v-if="selectedPoint.saleItem" label="Sale" color="warning" variant="soft" size="sm" />
        </div>
      </UCard>

      <table class="w-full border-collapse text-sm" aria-label="Family product comparison">
        <thead class="max-sm:hidden"><tr class="border-b border-(--line) text-left text-xs text-(--muted)"><th class="py-3 pr-3">Product</th><th class="py-3 pr-3">Brand / variant</th><th class="py-3 pr-3">Purchases / spend</th><th class="py-3 pr-3">Latest line total</th><th class="py-3 pr-3">Latest unit price</th><th class="py-3 pr-3">Average unit price</th><th class="py-3 pr-3">Lowest paid</th><th class="py-3 pr-3">Regular reference</th><th class="py-3">Vs. cheapest</th></tr></thead>
        <tbody>
          <tr v-for="row in visibleRows" :key="`${row.item}:${row.basis}`" class="border-b border-(--line) max-sm:grid max-sm:grid-cols-2 max-sm:gap-3 max-sm:py-4">
            <td class="min-w-0 py-4 pr-3 align-top max-sm:col-span-2 max-sm:p-0"><NuxtLink :to="itemPath(row.item)" class="font-semibold underline wrap-anywhere">{{ row.item }}</NuxtLink><p class="mt-1 text-xs text-(--muted)">{{ row.latest.location }} / {{ row.latest.purchasedOn }}<span v-if="row.latest.purchasedTime"> · {{ row.latest.purchasedTime }}</span></p></td>
            <td class="py-4 pr-3 align-top wrap-anywhere max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Brand / variant</span>{{ row.brand || '-' }}<p class="mt-1 text-(--muted)">{{ row.variant || '-' }}</p></td>
            <td class="py-4 pr-3 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Purchases / spend</span>{{ row.purchases }}<p class="mt-1">{{ formatMoney(row.totalSpent) }}</p></td>
            <td class="py-4 pr-3 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Latest line total</span>{{ formatMoney(row.latest.price) }}<p class="mt-1 text-xs text-(--muted)">{{ row.latest.size ? `${Number(row.latest.size)} ${row.latest.unit || ''}` : 'Unknown size' }}</p><UBadge v-if="row.latest.saleItem" label="Sale" color="warning" variant="soft" size="sm" class="mt-1" /></td>
            <td class="py-4 pr-3 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Latest unit price</span><strong>{{ unitMoney(row.latestNormalized) }}</strong><p class="mt-1 text-xs text-(--muted)">{{ row.basisLabel }}</p></td>
            <td class="py-4 pr-3 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Average unit price</span>{{ unitMoney(row.averageNormalized) }}</td>
            <td class="py-4 pr-3 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Lowest paid</span>{{ unitMoney(row.lowestNormalized) }}</td>
            <td class="py-4 pr-3 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Regular reference</span>{{ unitMoney(row.regularNormalized) }}</td>
            <td class="py-4 align-top tabular-nums max-sm:p-0">
              <span class="mb-1 block text-xs text-(--muted) sm:hidden">Vs. cheapest</span>
              <UBadge
                v-if="row.diffFromCheapestPercent !== null"
                :label="diffLabel(row.diffFromCheapestPercent)"
                :color="row.diffFromCheapestPercent === 0 ? 'success' : 'warning'"
                variant="soft"
                size="sm"
              />
              <span v-else>-</span>
            </td>
          </tr>
        </tbody>
      </table>

      <UCard v-if="visiblePurchases.length" class="mt-3 rounded-[22px] bg-(--surface) shadow-(--shadow) [border:1px_solid_var(--line)]">
        <div class="mb-3">
          <p class="mb-1 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Purchase log</p>
          <h2 class="text-xl">All {{ family }} purchases</h2>
        </div>
        <table class="item-purchases-table w-full border-collapse text-sm" aria-label="Family purchase history">
          <thead><tr><th>Date</th><th>Variant / Item</th><th>Store</th><th>Package</th><th>Price</th><th>Normalized</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            <tr v-for="entry in visiblePurchases" :key="entry.id">
              <td data-label="Date">{{ entry.purchasedOn }} <span v-if="entry.purchasedTime" class="text-xs text-(--muted)">{{ entry.purchasedTime }}</span></td>
              <td data-label="Variant / Item">
                <NuxtLink :to="itemPath(entry.item)" class="font-semibold underline">{{ entry.item }}</NuxtLink>
                <span v-if="entry.brand || entry.variant" class="ml-1.5 text-xs text-(--muted)">({{ [entry.brand, entry.variant].filter(Boolean).join(' · ') }})</span>
              </td>
              <td data-label="Store">{{ entry.location }}</td>
              <td data-label="Package">{{ entry.size ? `${Number(entry.size)} ${entry.unit || ''}`.trim() : entry.unit || 'Unknown size' }}</td>
              <td data-label="Price">{{ formatMoney(entry.price) }} <UBadge v-if="entry.saleItem" label="Sale" color="warning" variant="soft" size="sm" class="ml-1" /></td>
              <td data-label="Normalized"><strong>{{ unitMoney(entry.normalizedPrice) }}</strong> <span>{{ entry.basisLabel }}</span></td>
              <td class="item-purchase-action w-[1%] text-right whitespace-nowrap">
                <UButton :to="{ path: '/history/entries', query: { edit: entry.id } }" label="Edit" icon="i-lucide-pencil" color="neutral" variant="ghost" size="sm" class="touch-target" />
              </td>
            </tr>
          </tbody>
        </table>
      </UCard>
    </template>
  </div>
</template>