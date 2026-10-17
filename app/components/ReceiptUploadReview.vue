<script setup lang="ts">
import type { ExtractedLine, ExtractedReceipt, ReceiptDuplicate, ReceiptUpload } from '../../shared/types/receipt-upload'
import { reviewWarnings } from '../../shared/utils/receipt-review'
import type { ItemCatalog } from '../../shared/types/product'

const props = defineProps<{ upload: ReceiptUpload, duplicates: ReceiptDuplicate[], categories: string[], catalog?: ItemCatalog }>()
const emit = defineEmits<{ dirtyChange: [dirty: boolean], saved: [receiptId: string], updated: [] }>()
const { apiUrl } = useApi()
const draft = reactive<ExtractedReceipt>(structuredClone(toRaw(props.upload.draft!)))
const initialSnapshot = ref(JSON.stringify(draft))
const revision = ref(props.upload.revision)
const busy = ref(false)
const reviewed = ref(false)
const allowDuplicates = ref(false)
const matches = ref(props.duplicates)
const errorMessage = ref('')
const notice = ref('')
const warnings = computed(() => reviewWarnings(draft))
const readOnly = computed(() => props.upload.status !== 'review')
const dirty = computed(() => JSON.stringify(draft) !== initialSnapshot.value)
const sourceUrl = computed(() => apiUrl(`/receipt-uploads/${props.upload.id}/source`))
const lineKeys = ref(draft.lines.map((_, index) => index))
const productNames = computed(() => props.catalog?.products.map(product => product.item) ?? [])
const familyNames = computed(() => [...new Set(props.catalog?.products.flatMap(product => product.family ? [product.family] : []) ?? [])].sort())
let nextKey = draft.lines.length

watch(dirty, value => emit('dirtyChange', value), { immediate: true })
watch(() => JSON.stringify(draft), () => { reviewed.value = false; allowDuplicates.value = false })

function numberValue(value: unknown) {
  return value === '' || value === null || value === undefined ? null : Number(value)
}

function chooseProduct(line: ExtractedLine, value: string | { value: string }) {
  value = typeof value === 'string' ? value : value.value
  line.item = value || null
  const product = props.catalog?.products.find(product => product.item === value)
  if (product) Object.assign(line, { family: product.family, brand: product.brand, variant: product.variant, category: product.category })
}

function setFamily(line: ExtractedLine, value: string | { value: string }) {
  line.family = (typeof value === 'string' ? value : value.value) || null
}

function addLine() {
  const line: ExtractedLine = {
    rawDescription: '', item: null, family: null, category: null, brand: null, variant: null, quantity: null,
    size: null, unit: null, price: null, regularPrice: null, discount: null, saleItem: false,
    nonGrocery: false, notes: null, confidence: null
  }
  draft.lines.push(line)
  lineKeys.value.push(nextKey++)
}

function removeLine(index: number) {
  draft.lines.splice(index, 1)
  lineKeys.value.splice(index, 1)
}

async function save(approve: boolean) {
  busy.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    if (approve) {
      const result = await $fetch<{ receiptId: string }>(apiUrl(`/receipt-uploads/${props.upload.id}/approve`), {
        method: 'POST', body: { draft, revision: revision.value, reviewed: reviewed.value, allowDuplicates: allowDuplicates.value }
      })
      initialSnapshot.value = JSON.stringify(draft)
      emit('dirtyChange', false)
      emit('saved', result.receiptId)
    } else {
      const result = await $fetch<{ revision: number, duplicates?: ReceiptDuplicate[] }>(apiUrl(`/receipt-uploads/${props.upload.id}`), {
        method: 'PUT', body: { action: 'save', draft, revision: revision.value }
      })
      revision.value = result.revision
      matches.value = result.duplicates ?? matches.value
      allowDuplicates.value = false
      initialSnapshot.value = JSON.stringify(draft)
      notice.value = 'Corrections saved.'
      emit('updated')
    }
  } catch (error: any) {
    if (Array.isArray(error.data?.data?.duplicates)) {
      matches.value = error.data.data.duplicates
      allowDuplicates.value = false
    }
    errorMessage.value = error.data?.statusMessage || error.message || 'Could not save the receipt'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="min-w-0 border-t border-(--line) pt-6" aria-label="Receipt review">
    <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-xl! tracking-normal! wrap-anywhere">{{ upload.filename }}</h2>
        <p class="mt-1 text-sm text-(--muted)">Page {{ upload.page }} <span v-if="upload.model">· {{ upload.model }}</span></p>
      </div>
      <UButton :to="sourceUrl" external target="_blank" label="Open original" icon="i-lucide-external-link" color="neutral" variant="outline" />
    </header>

    <div class="grid min-w-0 gap-6 xl:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.5fr)]">
      <div class="min-w-0 self-start xl:sticky xl:top-24">
        <iframe v-if="upload.mime === 'application/pdf'" :src="sourceUrl" :title="`Original receipt, page ${upload.page}`" class="h-[540px] max-h-[65vh] w-full border border-(--line) bg-white" />
        <img v-else :src="sourceUrl" :alt="`Original receipt, page ${upload.page}`" class="max-h-[70vh] w-full border border-(--line) bg-white object-contain" loading="lazy">
      </div>

      <form class="grid min-w-0 gap-5" @submit.prevent="save(true)">
        <UAlert v-if="errorMessage" color="error" icon="i-lucide-circle-alert" :title="errorMessage" role="alert" />
        <UAlert v-if="notice" color="success" :title="notice" role="status" />
        <fieldset :disabled="readOnly || busy" class="grid min-w-0 grid-cols-2 gap-3">
          <UFormField label="Purchase date" class="min-w-0"><UInput :model-value="draft.purchasedOn ?? ''" type="date" aria-label="Purchase date" class="w-full" @update:model-value="draft.purchasedOn = $event || null" /></UFormField>
          <UFormField label="Printed time"><UInput :model-value="draft.purchasedTime ?? ''" type="time" step="60" aria-label="Printed time" class="w-full" @update:model-value="draft.purchasedTime = $event || null" /></UFormField>
          <UFormField label="Store" class="min-w-0"><UInput :model-value="draft.location ?? ''" aria-label="Store" class="w-full" @update:model-value="draft.location = $event || null" /></UFormField>
          <UFormField label="Currency"><UInput :model-value="draft.currency ?? ''" maxlength="3" aria-label="Currency" class="w-full" @update:model-value="draft.currency = $event.toUpperCase() || null" /></UFormField>
          <UFormField label="Receipt total (EUR)"><UInput :model-value="draft.total === null ? '' : String(draft.total)" type="number" step="0.01" aria-label="Receipt total" class="w-full" @update:model-value="draft.total = numberValue($event)" /></UFormField>
          <UFormField label="Receipt number" class="col-span-2"><UInput :model-value="draft.receiptNumber ?? ''" aria-label="Receipt number" class="w-full" @update:model-value="draft.receiptNumber = $event || null" /></UFormField>
        </fieldset>

        <div v-if="warnings.length" class="border-l-3 border-amber-500 pl-4 text-sm" role="status" aria-label="Review warnings">
          <strong>Needs attention</strong>
          <ul class="mt-2 grid list-disc gap-1 pl-4"><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul>
        </div>

        <div v-if="matches.length && !readOnly" class="border-l-3 border-amber-500 pl-4 text-sm" aria-label="Possible duplicates">
          <strong>Possible duplicates</strong>
          <ul class="my-2 grid gap-2">
            <li v-for="match in matches" :key="`${match.source}:${match.id}`" class="wrap-anywhere">
              <NuxtLink :to="match.source === 'receipt' ? `/receipts/${match.id}` : { path: '/receipts/upload', query: { review: match.id } }" target="_blank" class="underline">{{ match.location || 'Unknown store' }}</NuxtLink>
              <span> · {{ match.source === 'receipt' ? 'Saved receipt' : 'Pending draft' }} · {{ Math.round(match.similarity * 100) }}% item-name overlap</span>
              <p v-if="match.times?.length" class="mt-1 text-(--muted)">Printed time: {{ match.times.join(', ') }}<span v-if="match.timeMatch === true"> (same minute)</span><span v-else-if="match.timeMatch === false"> (different minute)</span></p>
              <p v-if="match.sameStore && match.source === 'receipt'" class="mt-1">Saving will append to this existing store/day receipt.</p>
            </li>
          </ul>
        </div>

        <fieldset :disabled="readOnly || busy" class="min-w-0">
          <legend class="mb-2 font-semibold">Items <span class="text-(--muted)">({{ draft.lines.length }})</span></legend>
          <div v-for="(line, index) in draft.lines" :key="lineKeys[index]" class="grid min-w-0 gap-3 border-t border-(--line) py-4" :data-line="index">
            <div class="flex min-w-0 items-center justify-between gap-2">
              <span class="text-sm font-semibold">{{ index + 1 }}<span v-if="line.confidence !== null" class="ml-2 font-normal text-(--muted)">{{ Math.round(line.confidence * 100) }}% confidence</span></span>
              <UTooltip text="Remove line"><UButton icon="i-lucide-trash-2" :aria-label="`Remove line ${index + 1}`" color="error" variant="ghost" :disabled="readOnly" @click="removeLine(index)" /></UTooltip>
            </div>
            <UFormField label="Product"><UInputMenu :model-value="line.item ?? ''" :items="productNames" mode="autocomplete" :create-item="{ when: 'always', position: 'top' }" :aria-label="`Product ${index + 1}`" class="w-full" @update:model-value="chooseProduct(line, $event)" @create="chooseProduct(line, $event)" /></UFormField>
            <UFormField label="Product family"><UInputMenu :model-value="line.family ?? ''" :items="familyNames" mode="autocomplete" :create-item="{ when: 'always', position: 'top' }" :maxlength="100" :aria-label="`Product family ${index + 1}`" class="w-full" @update:model-value="setFamily(line, $event)" @create="setFamily(line, $event)" /></UFormField>
            <div class="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
              <UFormField label="Paid total (EUR)"><UInput :model-value="line.price === null ? '' : String(line.price)" type="number" step="0.01" min="0" :aria-label="`Paid price ${index + 1}`" class="w-full" @update:model-value="line.price = numberValue($event)" /></UFormField>
              <UFormField label="Total size"><UInput :model-value="line.size === null ? '' : String(line.size)" type="number" step="0.001" min="0.001" :aria-label="`Total size ${index + 1}`" class="w-full" @update:model-value="line.size = numberValue($event)" /></UFormField>
              <UFormField label="Unit"><UnitInput :model-value="line.unit ?? ''" :aria-label="`Unit ${index + 1}`" class="w-full" @update:model-value="line.unit = $event || null" /></UFormField>
            </div>
            <UFormField label="Category" class="[&_.category-input]:grid [&_.category-input]:grid-cols-[minmax(0,1fr)_auto] [&_.category-input]:items-center [&_.category-input]:gap-1"><CategoryInput v-model="line.category" :items="categories" :aria-label="`Category ${index + 1}`" class="w-full min-w-0" /></UFormField>
            <div class="flex flex-wrap gap-4"><UCheckbox v-model="line.saleItem" label="On sale" /><UCheckbox v-model="line.nonGrocery" label="Non-grocery" /></div>
            <details :open="line.confidence !== null && line.confidence < 0.8">
              <summary class="cursor-pointer text-sm text-(--muted)">Product details</summary>
              <div class="mt-3 grid min-w-0 grid-cols-2 gap-3">
                <UFormField label="Brand"><UInput :model-value="line.brand ?? ''" :aria-label="`Brand ${index + 1}`" class="w-full" @update:model-value="line.brand = $event || null" /></UFormField>
                <UFormField label="Variant"><UInput :model-value="line.variant ?? ''" :aria-label="`Variant ${index + 1}`" class="w-full" @update:model-value="line.variant = $event || null" /></UFormField>
                <UFormField label="Quantity"><UInput :model-value="line.quantity === null ? '' : String(line.quantity)" type="number" step="any" :aria-label="`Quantity ${index + 1}`" class="w-full" @update:model-value="line.quantity = numberValue($event)" /></UFormField>
                <UFormField label="Regular line total (EUR)"><UInput :model-value="line.regularPrice === null ? '' : String(line.regularPrice)" type="number" step="0.01" :aria-label="`Regular price ${index + 1}`" class="w-full" @update:model-value="line.regularPrice = numberValue($event)" /></UFormField>
                <UFormField label="Discount (EUR)"><UInput :model-value="line.discount === null ? '' : String(line.discount)" type="number" step="0.01" :aria-label="`Discount ${index + 1}`" class="w-full" @update:model-value="line.discount = numberValue($event)" /></UFormField>
                <UFormField label="Notes" class="col-span-2"><UInput :model-value="line.notes ?? ''" maxlength="100" :aria-label="`Notes ${index + 1}`" class="w-full" @update:model-value="line.notes = $event || null" /></UFormField>
                <UFormField label="Receipt text" class="col-span-2"><UTextarea v-model="line.rawDescription" :aria-label="`Receipt text ${index + 1}`" class="w-full" /></UFormField>
              </div>
            </details>
          </div>
          <UButton v-if="!readOnly" label="Add line" icon="i-lucide-plus" variant="outline" color="neutral" :disabled="draft.lines.length >= 200" @click="addLine" />
        </fieldset>

        <div v-if="!readOnly" class="grid gap-4 border-t border-(--line) pt-5">
          <UCheckbox v-if="matches.length" v-model="allowDuplicates" label="Save anyway, despite the possible duplicates" :disabled="busy" />
          <UCheckbox v-model="reviewed" label="I verified the date, EUR currency, products, quantities, prices, total and warnings" :disabled="busy" />
          <div class="flex flex-wrap justify-end gap-2">
            <UButton label="Save corrections" icon="i-lucide-save" color="neutral" variant="outline" :loading="busy" :disabled="busy || !dirty" @click="save(false)" />
            <UButton type="submit" label="Approve receipt" icon="i-lucide-check" :loading="busy" :disabled="busy || !reviewed || (matches.length > 0 && !allowDuplicates) || draft.currency !== 'EUR' || !draft.lines.length" />
          </div>
        </div>
        <UButton v-else-if="upload.receiptId" :to="`/receipts/${upload.receiptId}`" label="View saved receipt" icon="i-lucide-receipt-text" color="neutral" variant="outline" class="justify-self-end" />
      </form>
    </div>
  </section>
</template>