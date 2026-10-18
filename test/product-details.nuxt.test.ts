import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ProductDetails from '../app/components/ProductDetails.vue'
import FamilyPage from '../app/pages/items/families.vue'

beforeEach(() => registerEndpoint('/api/auth/config', () => ({ enabled: false })))

it('shows stored identity, German source text, minute time, zero discounts and source links', async () => {
  const wrapper = await mountSuspended(ProductDetails, { props: { metadata: { productFamily: 'Milk', brand: 'Ja!', variant: '1.5%', rawDescription: 'JA! MILCH', purchasedTime: '21:34', quantity: '2', regularPrice: '2.4', discount: '0', sourceUploadId: 'source-id' } } })
  expect(wrapper.text()).toContain('Milk')
  expect(wrapper.text()).toContain('Ja!')
  expect(wrapper.text()).toContain('1.5%')
  expect(wrapper.text()).toContain('JA! MILCH')
  expect(wrapper.text()).toContain('21:34')
  expect(wrapper.text()).toContain('\u20ac0.00')
  expect(wrapper.get('a[href*="family=Milk"]').exists()).toBe(true)
  expect(wrapper.get('a[href="/api/receipt-uploads/source-id/source"]').exists()).toBe(true)
  wrapper.unmount()
})

it('hides absent legacy metadata and keeps compact summaries free of purchase-specific raw text', async () => {
  const empty = await mountSuspended(ProductDetails, { props: { metadata: {} } })
  expect(empty.text()).toBe('')
  empty.unmount()
  const compact = await mountSuspended(ProductDetails, { props: { metadata: { productFamily: 'Milk', rawDescription: 'JA! MILCH', quantity: 2 }, compact: true } })
  expect(compact.text()).toContain('Milk')
  expect(compact.text()).not.toContain('JA! MILCH')
  expect(compact.text()).not.toContain('Quantity')
  compact.unmount()
})

const Select = defineComponent({ props: ['modelValue', 'items'], emits: ['update:modelValue'], setup: (props, { emit, attrs }) => () => h('select', { ...attrs, value: props.modelValue, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value) }, props.items.map((item: any) => h('option', { value: item.value ?? item }, item.label ?? item))) })

it('shows different milk products separately and supports filtering incompatible price bases', async () => {
  const common = { purchasedOn: '2026-10-01', location: 'REWE', price: '1.20', size: '1', unit: 'L', costPerUnit: null, saleItem: false, productFamily: 'Milk' }
  registerEndpoint('/api/items/families', () => ({ families: [{ family: 'Milk', itemCount: 3, purchases: 3, totalSpent: '3.9' }], entries: [
    { ...common, id: '1', item: 'Ja! Milk 1.5%', brand: 'Ja!', variant: '1.5%' },
    { ...common, id: '2', purchasedOn: '2026-10-05', item: 'Ja! Milk 3%', brand: 'Ja!', variant: '3%', price: '1.50' },
    { ...common, id: '3', item: 'Milk powder', brand: 'Milsani', variant: 'Powder', size: '100', unit: 'g' }
  ] }))
  const wrapper = await mountSuspended(FamilyPage, { route: '/items/families?family=Milk', global: { stubs: { USelect: Select, USelectMenu: Select } } })
  await flushPromises()
  expect(wrapper.text()).toContain('Ja! Milk 1.5%')
  expect(wrapper.text()).toContain('Ja! Milk 3%')
  expect(wrapper.text()).toContain('Milk powder')
  expect(wrapper.text()).toContain('Per 100 mL')
  expect(wrapper.text()).toContain('Per 100 g')
  expect(wrapper.text()).toContain('Cheapest')
  expect(wrapper.text()).toContain('+25%')
  expect(wrapper.find('svg[aria-label="Milk family normalized price chart"]').exists()).toBe(true)
  expect(wrapper.find('table[aria-label="Family purchase history"]').exists()).toBe(true)
  await wrapper.get('select[aria-label="Price basis"]').setValue('volume')
  expect(wrapper.text()).not.toContain('Milk powder')
  wrapper.unmount()
})

it('shows a useful empty state without inventing families for legacy data', async () => {
  registerEndpoint('/api/items/families', () => ({ families: [], entries: [] }))
  const wrapper = await mountSuspended(FamilyPage, { route: '/items/families', global: { stubs: { USelectMenu: Select } } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('No product families recorded'))
  wrapper.unmount()
})