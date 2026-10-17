<script setup lang="ts">
import { familyPriceRows, type FamilyPurchase } from '../../../shared/utils/product-family'
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
const rows = computed(() => familyPriceRows(data.value?.entries ?? []))
const bases = computed(() => [...new Map(rows.value.map(row => [row.basis, { label: row.basisLabel, value: row.basis }])).values()])
const visibleRows = computed(() => rows.value.filter(row => basis.value === 'all' || row.basis === basis.value))
const summary = computed(() => data.value?.families.find(summary => summary.family === family.value))
watch(family, () => { basis.value = 'all' })

function unitMoney(value: number | null) {
  return value === null ? '-' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)
}
</script>

<template>
  <div class="mx-auto grid w-full max-w-350 min-w-0 gap-5 pb-12">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <h1 class="text-3xl tracking-normal!">Product families</h1>
      <UButton to="/" label="Receipts" icon="i-lucide-arrow-left" color="neutral" variant="outline" />
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
    <table v-else class="w-full border-collapse text-sm" aria-label="Family product comparison">
      <thead class="max-sm:hidden"><tr class="border-b border-(--line) text-left text-xs text-(--muted)"><th class="py-3 pr-3">Product</th><th class="py-3 pr-3">Brand / variant</th><th class="py-3 pr-3">Purchases / spend</th><th class="py-3 pr-3">Latest line total</th><th class="py-3 pr-3">Latest unit price</th><th class="py-3 pr-3">Lowest paid</th><th class="py-3">Regular reference</th></tr></thead>
      <tbody>
        <tr v-for="row in visibleRows" :key="`${row.item}:${row.basis}`" class="border-b border-(--line) max-sm:grid max-sm:grid-cols-2 max-sm:gap-3 max-sm:py-4">
          <td class="min-w-0 py-4 pr-3 align-top max-sm:col-span-2 max-sm:p-0"><NuxtLink :to="itemPath(row.item)" class="font-semibold underline wrap-anywhere">{{ row.item }}</NuxtLink><p class="mt-1 text-xs text-(--muted)">{{ row.latest.location }} / {{ row.latest.purchasedOn }}<span v-if="row.latest.purchasedTime"> · {{ row.latest.purchasedTime }}</span></p></td>
          <td class="py-4 pr-3 align-top wrap-anywhere max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Brand / variant</span>{{ row.brand || '-' }}<p class="mt-1 text-(--muted)">{{ row.variant || '-' }}</p></td>
          <td class="py-4 pr-3 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Purchases / spend</span>{{ row.purchases }}<p class="mt-1">{{ formatMoney(row.totalSpent) }}</p></td>
          <td class="py-4 pr-3 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Latest line total</span>{{ formatMoney(row.latest.price) }}<p class="mt-1 text-xs text-(--muted)">{{ row.latest.size ? `${Number(row.latest.size)} ${row.latest.unit || ''}` : 'Unknown size' }}</p><UBadge v-if="row.latest.saleItem" label="Sale" color="warning" variant="soft" size="sm" class="mt-1" /></td>
          <td class="py-4 pr-3 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Latest unit price</span><strong>{{ unitMoney(row.latestNormalized) }}</strong><p class="mt-1 text-xs text-(--muted)">{{ row.basisLabel }}</p></td>
          <td class="py-4 pr-3 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Lowest paid</span>{{ unitMoney(row.lowestNormalized) }}</td>
          <td class="py-4 align-top tabular-nums max-sm:p-0"><span class="mb-1 block text-xs text-(--muted) sm:hidden">Regular reference</span>{{ unitMoney(row.regularNormalized) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>