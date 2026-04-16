import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export function formatNumber(num: number) {
  return new Intl.NumberFormat('en-US').format(num)
}

export function formatPercent(num: number) {
  return `${(num * 100).toFixed(2)}%`
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '/adex'

export function api(path: string) {
  return `${BASE_PATH}${path}`
}
