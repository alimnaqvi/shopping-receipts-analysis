import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { createError, readBody } from 'h3'
import ReceiptUploadReview from '../app/components/ReceiptUploadReview.vue'
import UploadPage from '../app/pages/receipts/upload.vue'
import type { ExtractedReceipt, ReceiptUpload } from '../shared/types/receipt-upload'

const id = '12345678-1234-4123-8123-123456789abc'
const secondId = '22345678-1234-4123-8123-123456789abc'
const receipt: ExtractedReceipt = {
  purchasedOn: '2026-10-17', location: 'Market', currency: 'EUR', total: 2, receiptNumber: null, warnings: [],
  lines: [{ rawDescription: 'CHEESE', item: 'Cheese', category: 'Dairy', brand: 'Brand', variant: 'Organic', quantity: 1, size: 200, unit: 'g', price: null, regularPrice: 3, discount: 1, saleItem: true, nonGrocery: false, notes: null, confidence: 0.6 }]
}
const upload: ReceiptUpload = { id, filename: 'scan.jpg', page: 1, mime: 'image/jpeg', status: 'review', error: null, model: 'test-model', batchId: null, receiptId: null, extraction: receipt, draft: receipt, revision: 2, createdAt: '2026-10-17T00:00:00Z' }

const Slot = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
const Button = defineComponent({ props: ['label', 'disabled', 'type'], setup: (props, { attrs, slots }) => () => h('button', { ...attrs, type: props.type || 'button', disabled: props.disabled }, props.label || slots.default?.()) })
const Input = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup: (props, { emit, attrs }) => () => h('input', { ...attrs, value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) }) })
const Checkbox = defineComponent({ props: ['modelValue', 'label', 'disabled'], emits: ['update:modelValue'], setup: (props, { emit, attrs }) => () => h('label', [h('input', { ...attrs, type: 'checkbox', disabled: props.disabled, checked: props.modelValue, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).checked) }), props.label]) })
const Select = defineComponent({ props: ['modelValue', 'items'], emits: ['update:modelValue'], setup: (props, { emit, attrs }) => () => h('select', { ...attrs, value: props.modelValue, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value) }, props.items.map((item: any) => h('option', { value: item.value }, item.label))) })
const Alert = defineComponent({ props: ['title'], setup: props => () => h('p', props.title) })
const stubs = { UButton: Button, UInput: Input, UTextarea: Input, UCheckbox: Checkbox, USelect: Select, UFormField: Slot, UTooltip: Slot, UAlert: Alert, UIcon: true, CategoryInput: Input, UnitInput: Input, UFileUpload: true }
let requests: any[]
let failSave: boolean
let conflictApprove: boolean
let queue: ReceiptUpload[]

beforeEach(() => {
  requests = []
  failSave = false
  conflictApprove = false
  queue = [{ ...upload, status: 'pending', draft: null }, { ...upload, id: secondId, page: 2, status: 'pending', draft: null }]
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/categories', () => ['Dairy'])
  registerEndpoint('/api/receipt-uploads', () => ({ uploads: queue, hasMore: false, configured: true, model: 'test-model' }))
  registerEndpoint(`/api/receipt-uploads/${id}`, { method: 'GET', handler: () => ({ upload, duplicates: [] }) })
  registerEndpoint(`/api/receipt-uploads/${id}`, { method: 'PUT', handler: async event => {
    const body = await readBody(event)
    requests.push(body)
    if (failSave) throw createError({ statusCode: 409, statusMessage: 'This draft changed in another tab' })
    return { revision: 3 }
  } })
  registerEndpoint(`/api/receipt-uploads/${id}/approve`, { method: 'POST', handler: async event => {
    requests.push(await readBody(event))
    if (conflictApprove) throw createError({ statusCode: 409, statusMessage: 'Possible duplicate receipt', data: { duplicates: [{ id: '7', source: 'receipt', location: 'New match', similarity: 1, sameStore: true }] } })
    return { receiptId: '7' }
  } })
  for (const pageId of [id, secondId]) registerEndpoint(`/api/receipt-uploads/${pageId}/process`, { method: 'POST', handler: () => {
    requests.push({ process: pageId })
    queue = queue.map(row => row.id === pageId ? { ...row, status: pageId === id ? 'review' : 'failed', error: pageId === id ? null : 'Provider refused' } : row)
    if (pageId === secondId) throw createError({ statusCode: 502, statusMessage: 'Provider refused' })
    return { status: 'review' }
  } })
  registerEndpoint('/api/receipt-uploads/batch', { method: 'POST', handler: async event => {
    requests.push(await readBody(event))
    queue = queue.map(row => ({ ...row, status: 'batch', batchId: 'batch_test' }))
    return { batchId: 'batch_test' }
  } })
  registerEndpoint('/api/receipt-uploads/batch/batch_test', { method: 'POST', handler: async event => {
    requests.push(await readBody(event))
    queue = queue.map(row => ({ ...row, status: row.id === id ? 'review' : 'failed' }))
    return { status: 'completed' }
  } })
})

it('keeps missing prices blank, saves corrections without inserting purchases, then approves the current revision', async () => {
  const wrapper = await mountSuspended(ReceiptUploadReview, { props: { upload, duplicates: [], categories: ['Dairy'] }, global: { stubs } })
  expect((wrapper.get('input[aria-label="Paid price 1"]').element as HTMLInputElement).value).toBe('')
  expect(wrapper.text()).toContain('low extraction confidence')
  await wrapper.get('input[aria-label="Paid price 1"]').setValue('2')
  await wrapper.get('input[aria-label="Brand 1"]').setValue('Corrected brand')
  expect(requests).toHaveLength(0)
  await wrapper.findAll('button').find(button => button.text() === 'Save corrections')!.trigger('click')
  await flushPromises()
  expect(requests[0]).toMatchObject({ action: 'save', revision: 2, draft: { lines: [{ price: 2, brand: 'Corrected brand' }] } })
  expect(upload.draft!.lines[0].price).toBeNull()
  await vi.waitFor(() => expect(wrapper.text()).toContain('Corrections saved'))
  await wrapper.get('input[type="checkbox"]').setValue(false)
  await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(requests[1]).toMatchObject({ revision: 3, reviewed: true, allowDuplicates: false })
  await vi.waitFor(() => expect(wrapper.emitted('saved')).toEqual([['7']]))
  wrapper.unmount()
})

it('requires explicit duplicate override and clears confirmations when a correction changes', async () => {
  const wrapper = await mountSuspended(ReceiptUploadReview, { props: { upload, duplicates: [{ id: '7', source: 'receipt', location: 'Market', similarity: 1, sameStore: true }], categories: [] }, global: { stubs } })
  expect(wrapper.text()).toContain('append to this existing store/day receipt')
  const approve = wrapper.findAll('button').find(button => button.text() === 'Approve receipt')!
  await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true)
  expect(approve.attributes('disabled')).toBeDefined()
  await wrapper.findAll('input[type="checkbox"]').at(-2)!.setValue(true)
  expect(approve.attributes('disabled')).toBeUndefined()
  await wrapper.get('input[aria-label="Product 1"]').setValue('Corrected cheese')
  expect(approve.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('surfaces newly discovered duplicates returned during approval without discarding corrections', async () => {
  conflictApprove = true
  const wrapper = await mountSuspended(ReceiptUploadReview, { props: { upload, duplicates: [], categories: [] }, global: { stubs } })
  await wrapper.get('input[aria-label="Product 1"]').setValue('Corrected cheese')
  await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true)
  await wrapper.get('form').trigger('submit')
  await vi.waitFor(() => expect(wrapper.text()).toContain('New match'))
  expect((wrapper.get('input[aria-label="Product 1"]').element as HTMLInputElement).value).toBe('Corrected cheese')
  expect(wrapper.findAll('button').find(button => button.text() === 'Approve receipt')!.attributes('disabled')).toBeDefined()
  expect(wrapper.emitted('saved')).toBeUndefined()
  wrapper.unmount()
})

it('hides the previous editor while another receipt is loading', async () => {
  let resolveDetail: ((value: unknown) => void) | undefined
  registerEndpoint(`/api/receipt-uploads/${secondId}`, { method: 'GET', handler: () => new Promise(resolve => { resolveDetail = resolve }) })
  const wrapper = await mountSuspended(UploadPage, { route: '/receipts/upload', global: { stubs } })
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text().includes('scan.jpg · Page 1'))!.trigger('click')
  await vi.waitFor(() => expect(wrapper.find('input[aria-label="Product 1"]').exists()).toBe(true))
  await wrapper.findAll('button').find(button => button.text().includes('scan.jpg · Page 2'))!.trigger('click')
  expect(wrapper.find('input[aria-label="Product 1"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('Loading receipt')
  await vi.waitFor(() => expect(resolveDetail).toBeTypeOf('function'))
  resolveDetail!({ upload: { ...upload, id: secondId, page: 2 }, duplicates: [] })
  await vi.waitFor(() => expect(wrapper.find('input[aria-label="Product 1"]').exists()).toBe(true))
  wrapper.unmount()
})

it('keeps failed saves dirty and supports adding/removing lines without converting blanks to zero', async () => {
  failSave = true
  const wrapper = await mountSuspended(ReceiptUploadReview, { props: { upload, duplicates: [], categories: [] }, global: { stubs } })
  await wrapper.findAll('button').find(button => button.text() === 'Add line')!.trigger('click')
  expect(wrapper.findAll('[data-line]')).toHaveLength(2)
  await wrapper.get('input[aria-label="Paid price 2"]').setValue('0')
  await wrapper.get('input[aria-label="Paid price 2"]').setValue('')
  await wrapper.findAll('button').find(button => button.text() === 'Save corrections')!.trigger('click')
  await flushPromises()
  expect(requests[0].draft.lines[1].price).toBeNull()
  expect(wrapper.text()).toContain('This draft changed')
  expect(wrapper.emitted('dirtyChange')!.at(-1)).toEqual([true])
  await wrapper.get('button[aria-label="Remove line 2"]').trigger('click')
  expect(wrapper.findAll('[data-line]')).toHaveLength(1)
  expect(wrapper.emitted('saved')).toBeUndefined()
  wrapper.unmount()
})

it('starts immediate extraction only on command and leaves partial failures retryable', async () => {
  const wrapper = await mountSuspended(UploadPage, { route: '/receipts/upload', global: { stubs: { ...stubs, ReceiptUploadReview: true } } })
  await flushPromises()
  expect(requests).toHaveLength(0)
  await wrapper.findAll('label').find(label => label.text() === 'Select pending')!.get('input').setValue(true)
  await wrapper.findAll('button').find(button => button.text() === 'Extract selected (2)')!.trigger('click')
  await flushPromises()
  expect(requests.filter(request => request.process)).toHaveLength(2)
  expect(wrapper.text()).toContain('Provider refused')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Awaiting review'))
  expect(wrapper.text()).toContain('Failed')
  wrapper.unmount()
})

it('submits explicitly selected Batch jobs and refreshes completed results without approving them', async () => {
  const wrapper = await mountSuspended(UploadPage, { route: '/receipts/upload', global: { stubs: { ...stubs, ReceiptUploadReview: true } } })
  await flushPromises()
  await wrapper.findAll('label').find(label => label.text() === 'Select pending')!.get('input').setValue(true)
  await wrapper.get('select[aria-label="Processing mode"]').setValue('batch')
  await wrapper.findAll('button').find(button => button.text() === 'Extract selected (2)')!.trigger('click')
  await flushPromises()
  expect(requests[0]).toEqual({ ids: [id, secondId] })
  await vi.waitFor(() => expect(wrapper.text()).toContain('In batch'))
  await wrapper.findAll('button').find(button => button.text() === 'Refresh batches')!.trigger('click')
  await flushPromises()
  expect(requests[1]).toEqual({ cancel: false })
  await vi.waitFor(() => expect(wrapper.text()).toContain('Awaiting review'))
  expect(requests).toHaveLength(2)
  wrapper.unmount()
})