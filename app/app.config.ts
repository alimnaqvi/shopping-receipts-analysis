const inputBase = 'w-full min-h-[52px] px-3.5 py-[11px] rounded-xl border border-(--line) bg-(--surface-strong) text-(--ink) focus:border-(--accent) focus:outline-[3px] focus:outline-(--focus-ring) focus:outline-offset-2 focus:shadow-none transition-[border-color,box-shadow] duration-150'
const comboboxContent = 'max-h-[min(28rem,var(--reka-combobox-content-available-height,28rem))]'
const selectContent = 'max-h-[min(28rem,var(--reka-select-content-available-height,28rem))]'

export default defineAppConfig({
  ui: {
    input: { slots: { base: inputBase } },
    inputMenu: { slots: { base: inputBase, content: comboboxContent } },
    textarea: { slots: { base: inputBase } },
    select: { slots: { base: inputBase, content: selectContent } },
    selectMenu: { slots: { base: inputBase, content: comboboxContent } },
    colors: {
      primary: 'green',
      success: 'emerald',
      warning: 'amber',
      error: 'red',
      neutral: 'stone'
    }
  }
})
