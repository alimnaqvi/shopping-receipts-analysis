<script setup lang="ts">
import type { ReceiptDuplicate, ReceiptUpload } from '../../../shared/types/receipt-upload'
import type { ItemCatalog } from '../../../shared/types/product'

type Detail = { upload: ReceiptUpload, duplicates: ReceiptDuplicate[], catalog?: ItemCatalog }
type Queue = { uploads: ReceiptUpload[], hasMore: boolean, configured: boolean, model: string }
const { apiUrl } = useApi()
const route = useRoute()
const files = ref<File[]>([])
const uploads = ref<ReceiptUpload[]>([])
const selected = ref<string[]>([])
const detail = ref<Detail | null>(null)
const categories = ref<string[]>([])
const loading = ref(false)
const loadingDetail = ref(false)
const busy = ref(false)
const configured = ref(false)
const model = ref('')
const hasMore = ref(false)
const archived = ref(false)
const mode = ref('immediate')
const errors = ref<string[]>([])
const notice = ref('')
const uploadProgress = ref('')
const reviewDirty = ref(false)
const discardConfirmOpen = ref(false)
const pendingAction = shallowRef<(() => void) | null>(null)
let detailRequest = 0
const pending = computed(() => uploads.value.filter(upload => ['pending', 'failed', 'processing'].includes(upload.status)))
const batches = computed(() => [...new Set(uploads.value.filter(upload => upload.status === 'batch').map(upload => upload.batchId!))])
const statusLabels: Record<string, string> = { pending: 'Pending', processing: 'Extracting', batch: 'In batch', review: 'Awaiting review', failed: 'Failed', saved: 'Saved', discarded: 'Skipped' }

function errorText(error: any) {
  return error.data?.statusMessage || error.message || 'Request failed'
}

function guardAction(action: () => void) {
  if (reviewDirty.value) {
    pendingAction.value = action
    discardConfirmOpen.value = true
  } else action()
}

function discardChanges() {
  reviewDirty.value = false
  discardConfirmOpen.value = false
  pendingAction.value?.()
  pendingAction.value = null
}

async function loadQueue(append = false) {
  loading.value = true
  try {
    const result = await $fetch<Queue>(apiUrl('/receipt-uploads'), { query: { offset: append ? uploads.value.length : 0, archived: archived.value } })
    uploads.value = append ? [...uploads.value, ...result.uploads] : result.uploads
    hasMore.value = result.hasMore
    configured.value = result.configured
    model.value = result.model
    selected.value = selected.value.filter(id => pending.value.some(upload => upload.id === id))
  } catch (error) {
    errors.value.push(errorText(error))
  } finally {
    loading.value = false
  }
}

async function openUpload(id: string) {
  const request = ++detailRequest
  loadingDetail.value = true
  try {
    const result = await $fetch<Detail>(apiUrl(`/receipt-uploads/${id}`))
    if (request !== detailRequest) return
    reviewDirty.value = false
    detail.value = result
  } catch (error) {
    errors.value.push(errorText(error))
  } finally {
    if (request === detailRequest) loadingDetail.value = false
  }
}

async function uploadFiles() {
  if (!files.value.length || files.value.length > 100) {
    errors.value = ['Choose between 1 and 100 files.']
    return
  }
  busy.value = true
  errors.value = []
  notice.value = ''
  let duplicates = 0
  let created = 0
  const failedFiles: File[] = []
  for (const [index, file] of files.value.entries()) {
    uploadProgress.value = `Uploading ${index + 1} of ${files.value.length}: ${file.name}`
    try {
      const result = await $fetch<{ uploads: Array<{ id: string, duplicate: boolean }> }>(apiUrl('/receipt-uploads'), {
        method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Receipt-Filename': encodeURIComponent(file.name) }
      })
      duplicates += result.uploads.filter(upload => upload.duplicate).length
      created += result.uploads.filter(upload => !upload.duplicate).length
    } catch (error) {
      errors.value.push(`${file.name}: ${errorText(error)}`)
      failedFiles.push(file)
    }
  }
  files.value = failedFiles
  uploadProgress.value = ''
  notice.value = `${created} new receipt pages. ${duplicates} exact duplicates skipped.`
  await loadQueue()
  busy.value = false
}

function toggleSelection(id: string, checked: boolean | 'indeterminate') {
  selected.value = checked === true ? [...new Set([...selected.value, id])] : selected.value.filter(value => value !== id)
}

async function startExtraction() {
  if (!selected.value.length || !configured.value) return
  const ids = [...selected.value]
  busy.value = true
  errors.value = []
  notice.value = ''
  try {
    if (mode.value === 'batch') {
      await $fetch(apiUrl('/receipt-uploads/batch'), { method: 'POST', body: { ids } })
      notice.value = `${ids.length} receipt pages submitted to Batch.`
    } else {
      let next = 0
      async function worker() {
        while (next < ids.length) {
          const id = ids[next++]!
          const upload = uploads.value.find(value => value.id === id)
          if (upload) upload.status = 'processing'
          try {
            await $fetch(apiUrl(`/receipt-uploads/${id}/process`), { method: 'POST', retry: 0 })
          } catch (error) {
            errors.value.push(`${upload?.filename ?? id}: ${errorText(error)}`)
          }
        }
      }
      await Promise.all([worker(), worker()])
      notice.value = 'Extraction finished.'
    }
  } catch (error) {
    errors.value.push(errorText(error))
  } finally {
    selected.value = []
    await loadQueue()
    const ready = uploads.value.find(upload => ids.includes(upload.id) && upload.status === 'review')
    if (ready) await openUpload(ready.id)
    busy.value = false
  }
}

async function refreshBatches(cancelId?: string) {
  busy.value = true
  errors.value = []
  try {
    for (const id of cancelId ? [cancelId] : batches.value) {
      const result = await $fetch<{ status: string }>(apiUrl(`/receipt-uploads/batch/${id}`), { method: 'POST', body: { cancel: Boolean(cancelId) }, retry: 0 })
      notice.value = `Batch: ${result.status}.`
    }
    await loadQueue()
    if (detail.value) await openUpload(detail.value.upload.id)
  } catch (error) {
    errors.value.push(errorText(error))
  } finally {
    busy.value = false
  }
}

async function setSkipped(upload: ReceiptUpload, skipped: boolean) {
  try {
    await $fetch(apiUrl(`/receipt-uploads/${upload.id}`), { method: 'PUT', body: { action: skipped ? 'discard' : 'restore' } })
    await loadQueue()
    if (detail.value?.upload.id === upload.id) { detail.value = null; reviewDirty.value = false }
  } catch (error) {
    errors.value.push(errorText(error))
  }
}

async function approved(receiptId: string) {
  reviewDirty.value = false
  notice.value = `Receipt approved.`
  const previousId = detail.value?.upload.id
  await loadQueue()
  const next = uploads.value.find(upload => upload.status === 'review' && upload.id !== previousId)
  if (next) await openUpload(next.id)
  else if (previousId) await openUpload(previousId)
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (reviewDirty.value) { event.preventDefault(); event.returnValue = '' }
}

onBeforeRouteLeave((to) => {
  if (!reviewDirty.value) return
  guardAction(() => { navigateTo(to.fullPath) })
  return false
})
watch(() => route.query.review, value => {
  if (typeof value === 'string') guardAction(() => { openUpload(value) })
})
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload)
  await loadQueue()
  try { categories.value = await $fetch<string[]>(apiUrl('/categories')) } catch (error) { errors.value.push(errorText(error)) }
  if (typeof route.query.review === 'string') await openUpload(route.query.review)
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <div class="mx-auto grid w-full max-w-350 min-w-0 gap-6 pb-12">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div><UButton to="/" label="Receipts" icon="i-lucide-arrow-left" variant="link" color="neutral" class="mb-2 px-0" /><h1 class="text-3xl tracking-normal!">Receipt uploads</h1></div>
      <span class="text-sm text-(--muted)">{{ model }} · EUR</span>
    </header>
    <UAlert v-if="!configured && !loading" color="warning" icon="i-lucide-key-round" title="Extraction is unavailable: configure OPENAI_API_KEY on the server." />
    <UAlert v-for="(error, index) in errors" :key="index" color="error" icon="i-lucide-circle-alert" :title="error" role="alert" />
    <UAlert v-if="notice" color="success" :title="notice" role="status" />

    <form class="grid min-w-0 items-end gap-3 border-y border-(--line) py-5 sm:grid-cols-[minmax(0,1fr)_auto]" @submit.prevent="uploadFiles">
      <UFileUpload v-model="files" multiple accept=".jpg,.jpeg,.png,.pdf" layout="list" label="Receipt files" description="JPEG, PNG or PDF · 20 MiB per file" :disabled="busy" class="min-w-0" />
      <UButton type="submit" label="Upload files" icon="i-lucide-upload" :loading="busy" :disabled="busy || !files.length" class="justify-center" />
      <p v-if="uploadProgress" class="col-span-full text-sm wrap-anywhere" role="status">{{ uploadProgress }}</p>
    </form>

    <section aria-label="Upload queue" class="grid min-w-0 gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl! tracking-normal!">Queue</h2>
        <div class="flex flex-wrap items-center gap-3">
          <UCheckbox v-model="archived" label="Include saved and skipped" :disabled="busy" @update:model-value="loadQueue()" />
          <UTooltip text="Refresh queue"><UButton icon="i-lucide-refresh-cw" aria-label="Refresh queue" color="neutral" variant="ghost" :loading="loading" :disabled="busy" @click="loadQueue()" /></UTooltip>
          <UButton v-if="batches.length" label="Refresh batches" icon="i-lucide-refresh-cw" color="neutral" variant="outline" :disabled="busy" @click="guardAction(() => refreshBatches())" />
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <UCheckbox :model-value="pending.length > 0 && selected.length === pending.length" label="Select pending" :disabled="busy || !pending.length" @update:model-value="selected = $event === true ? pending.slice(0, 100).map(upload => upload.id) : []" />
        <USelect v-model="mode" :items="[{ label: 'Immediate', value: 'immediate' }, { label: 'Batch · 50% discount · up to 24h', value: 'batch' }]" aria-label="Processing mode" class="w-full sm:w-72" :disabled="busy" />
        <UButton :label="`Extract selected (${selected.length})`" icon="i-lucide-scan-text" :disabled="busy || !configured || !selected.length || selected.length > 100" :loading="busy" @click="guardAction(startExtraction)" />
      </div>
      <p v-if="!uploads.length && !loading" class="py-8 text-center text-(--muted)">No receipts awaiting review.</p>
      <ul class="max-h-96 overflow-y-auto border-y border-(--line)">
        <li v-for="upload in uploads" :key="upload.id" class="flex min-w-0 items-center gap-3 border-b border-(--line) px-2 py-3 last:border-b-0" :class="detail?.upload.id === upload.id ? 'bg-(--accent-soft)' : ''">
          <UCheckbox v-if="['pending', 'failed', 'processing'].includes(upload.status)" :model-value="selected.includes(upload.id)" :aria-label="`Select ${upload.filename} page ${upload.page}`" :disabled="busy" @update:model-value="toggleSelection(upload.id, $event)" />
          <UIcon v-else :name="upload.status === 'saved' ? 'i-lucide-circle-check' : upload.status === 'batch' ? 'i-lucide-clock' : 'i-lucide-file-check'" class="size-5 shrink-0 text-(--muted)" />
          <button type="button" class="grid min-w-0 flex-1 gap-1 text-left" :disabled="busy" @click="guardAction(() => openUpload(upload.id))">
            <strong class="text-sm wrap-anywhere">{{ upload.filename }} · Page {{ upload.page }}</strong>
            <span class="text-xs text-(--muted)">{{ statusLabels[upload.status] }}</span>
            <span v-if="upload.error" class="text-xs text-(--danger) wrap-anywhere">{{ upload.error }}</span>
          </button>
          <UTooltip v-if="['pending', 'failed', 'review', 'discarded'].includes(upload.status)" :text="upload.status === 'discarded' ? 'Restore receipt' : 'Skip receipt'">
            <UButton :icon="upload.status === 'discarded' ? 'i-lucide-rotate-ccw' : 'i-lucide-archive'" :aria-label="`${upload.status === 'discarded' ? 'Restore' : 'Skip'} ${upload.filename} page ${upload.page}`" color="neutral" variant="ghost" :disabled="busy" @click="guardAction(() => setSkipped(upload, upload.status !== 'discarded'))" />
          </UTooltip>
        </li>
      </ul>
      <UButton v-if="hasMore" label="Load more" color="neutral" variant="outline" :loading="loading" class="justify-self-center" @click="loadQueue(true)" />
    </section>

    <p v-if="loadingDetail" role="status" class="border-t border-(--line) py-6 text-(--muted)">Loading receipt…</p>
    <ReceiptUploadReview v-else-if="detail?.upload.draft" :key="`${detail.upload.id}:${detail.upload.revision}`" :upload="detail.upload" :duplicates="detail.duplicates" :categories="categories" :catalog="detail.catalog" @dirty-change="reviewDirty = $event" @saved="approved" @updated="loadQueue()" />
    <section v-else-if="detail" class="grid gap-3 border-t border-(--line) pt-5" aria-label="Selected upload">
      <h2 class="text-xl! tracking-normal! wrap-anywhere">{{ detail.upload.filename }} · Page {{ detail.upload.page }}</h2>
      <p>{{ statusLabels[detail.upload.status] }}</p>
      <UButton v-if="detail.upload.status === 'batch' && detail.upload.batchId" label="Cancel batch" icon="i-lucide-circle-x" color="error" variant="outline" class="justify-self-start" :disabled="busy" @click="refreshBatches(detail.upload.batchId!)" />
      <UButton :to="apiUrl(`/receipt-uploads/${detail.upload.id}/source`)" external target="_blank" label="Open original" icon="i-lucide-external-link" color="neutral" variant="outline" class="justify-self-start" />
    </section>

    <UModal v-model:open="discardConfirmOpen" title="Discard unsaved corrections?">
      <template #body><p>Your latest corrections have not been saved.</p></template>
      <template #footer><UButton label="Keep editing" color="neutral" variant="outline" @click="discardConfirmOpen = false" /><UButton label="Discard changes" color="error" @click="discardChanges" /></template>
    </UModal>
  </div>
</template>