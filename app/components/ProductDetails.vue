<script setup lang="ts">
import type { ProductMetadata } from '../../shared/types/product'
import { formatMoney } from '../../shared/utils/currency'

const props = defineProps<{ metadata: ProductMetadata, compact?: boolean }>()
const { apiUrl } = useApi()
const fields = computed(() => [
  { label: 'Family', value: props.metadata.productFamily },
  { label: 'Brand', value: props.metadata.brand },
  { label: 'Variant', value: props.metadata.variant },
  { label: 'Printed time', value: props.metadata.purchasedTime },
  ...props.compact ? [] : [
    { label: 'Quantity', value: props.metadata.quantity == null ? null : String(props.metadata.quantity) },
    { label: 'Regular line total', value: props.metadata.regularPrice == null ? null : formatMoney(props.metadata.regularPrice) },
    { label: 'Discount', value: props.metadata.discount == null ? null : formatMoney(props.metadata.discount) },
    { label: 'Receipt text', value: props.metadata.rawDescription }
  ]
].filter(field => field.value !== null && field.value !== undefined && field.value !== ''))
</script>

<template>
  <div v-if="fields.length || (!compact && metadata.sourceUploadId)" class="min-w-0" aria-label="Product details">
    <dl class="grid min-w-0 grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-4">
      <div v-for="field in fields" :key="field.label" class="min-w-0" :class="field.label === 'Receipt text' ? 'col-span-full' : ''">
        <dt class="text-xs text-(--muted)">{{ field.label }}</dt>
        <dd class="mt-1 wrap-anywhere">
          <NuxtLink v-if="field.label === 'Family'" :to="{ path: '/items/families', query: { family: field.value } }" class="underline">{{ field.value }}</NuxtLink>
          <span v-else>{{ field.value }}</span>
        </dd>
      </div>
    </dl>
    <UButton v-if="!compact && metadata.sourceUploadId" :to="apiUrl(`/receipt-uploads/${metadata.sourceUploadId}/source`)" external target="_blank" label="Original receipt" icon="i-lucide-external-link" color="neutral" variant="link" size="sm" class="mt-2 px-0" />
  </div>
</template>