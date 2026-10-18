<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  items: string[]
  placeholder?: string
  clearLabel?: string
  clearAttr?: string
}>(), {
  placeholder: 'Uncategorized',
  clearLabel: 'Clear item category',
  clearAttr: 'data-category-clear'
})
const model = defineModel<string | null>({ required: true })
const emit = defineEmits<{ change: [category:string | null], tabNext: [] }>()
const open = ref(false)

function selectCategory(value: string | null) {
  const category = value?.trim() || null
  model.value = category
  emit('change', category)
}

function createCategory(value: string | { value: string }) {
  selectCategory((typeof value === 'string' ? value : value.value).trim())
}

function advanceFromInput(event: KeyboardEvent) {
  event.preventDefault()
  open.value = false
  const clear = (event.currentTarget as HTMLElement).closest('.category-input')?.querySelector<HTMLButtonElement>(`[${props.clearAttr}]`)
  if (clear && !clear.disabled) clear.focus()
  else emit('tabNext')
}
</script>

<template>
  <div class="category-input">
    <UInputMenu
      v-bind="$attrs"
      :model-value="model ?? ''"
      v-model:open="open"
      :items="props.items"
      :create-item="{ when: 'always', position: 'top' }"
      :maxlength="100"
      :placeholder="props.placeholder"
      @update:model-value="selectCategory"
      @create="createCategory"
      @keydown.tab.exact="advanceFromInput"
    >
      <template #create-item-label="{ item }">Add “{{ item }}”</template>
    </UInputMenu>
    <UButton
      v-if="model"
      type="button"
      v-bind="{ [props.clearAttr]: '' }"
      icon="i-lucide-x"
      :aria-label="props.clearLabel"
      color="neutral"
      variant="ghost"
      size="md"
      @click="selectCategory(null)"
      @keydown.tab.exact.prevent="emit('tabNext')"
    />
  </div>
</template>

