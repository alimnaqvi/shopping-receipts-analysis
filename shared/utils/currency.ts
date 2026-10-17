export function formatMoney(value: string | number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(Number(value))
}