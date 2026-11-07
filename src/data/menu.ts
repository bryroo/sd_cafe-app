// Menu catalogue (SRS MENU_CATEGORY, MENU_ITEM, OPTION_GROUP, OPTION_VALUE), loaded from the database
// by src/data/catalog.ts before the app renders and kept live (FR-OPS-04: sold-out reaches customers).
// The exports keep the shapes the screens have always used; the arrays are filled in place.
import { defaultOptions, peso as pesoFormat, type Group, type Item } from '../../supabase/functions/_shared/pricing'

// Menu photos made by scripts/menu-photos.mjs; the database's image_url names the file.
const photoUrls = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../assets/menu/*.webp', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => [path.split('/').pop()!, url]),
)

/* ----- Sections ----- */

export type Section = string

export type SectionInfo = {
  id: Section
  title: string
  /** Label on the menu tabs. */
  tab: string
  /** Coffee, Non-Coffee or Food; empty for collections. */
  group: string
  /** A collection lists every product whose badges include this one. */
  badge?: string
}

export const sections: SectionInfo[] = []
/** The printed menu's boards, in order (collections excluded). */
export const boards: SectionInfo[] = []
/** Best Sellers, Must-Try, Kids' Favorites: built from the badges. */
export const collections: SectionInfo[] = []

/* ----- Products ----- */

export type Size = { label: string; price: number }

export type Product = {
  id: string
  name: string
  /** Short line shown on list rows; falls back to the description or the sizes. */
  blurb: string
  /** Longer copy on the product detail screen. */
  description: string
  /** Lowest price the item sells for: the menu row price and "From" on the product page. */
  price: number
  /** Highest size price; equals price when the item has one price. */
  priceMax: number
  /** Every badge printed for the item; the first one shows on menu rows. */
  badges: string[]
  badge?: string
  isNew?: boolean
  /** The menu board the item is printed on. */
  section: Section
  kind: 'drink' | 'food'
  /** Temperatures a drink comes in (used by the Hot/Iced filter chips). */
  temps?: ('Hot' | 'Iced')[]
  /** Drink sizes with their own prices, cheapest first. */
  sizes: Size[]
  available: boolean
  /** Why staff marked it sold out (FR-OPS-04) */
  unavailableReason?: string
  /** Menu photo URL; items without one show a placeholder tile. */
  image?: string
  /** The item's option groups, as the pricing engine reads them */
  groups: Group[]
}

export const products: Product[] = []

/* ----- Loading (rows from the database) ----- */

export type CategoryRow = { category_id: string; title: string; menu_group: string | null; kind: 'board' | 'collection'; badge_match: string | null; sort_order: number }
export type ItemRow = {
  item_id: string
  category_id: string
  kind: 'drink' | 'food'
  name: string
  description: string
  blurb: string | null
  badges: string[]
  image_url: string | null
  price: number | null
  is_new: boolean
  is_available: boolean
  unavailable_reason: string | null
  sort_order: number
  option_group: {
    code: string
    title: string
    is_required: boolean
    pick: 'one' | 'many'
    is_size: boolean
    sort_order: number
    option_value: { value_id: number; label: string; price: number; badge: string | null; is_default: boolean; is_available: boolean; sort_order: number }[]
  }[]
}

const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order
const fill = <T,>(arr: T[], items: T[]) => arr.splice(0, arr.length, ...items)

function toProduct(r: ItemRow): Product {
  const groups: Group[] = [...r.option_group].sort(bySort).map((g) => ({
    code: g.code,
    title: g.title,
    required: g.is_required,
    pick: g.pick,
    isSize: g.is_size,
    choices: [...g.option_value].sort(bySort).map((v) => ({
      valueId: v.value_id,
      label: v.label,
      price: v.price / 100,
      available: v.is_available,
      isDefault: v.is_default,
      badge: v.badge ?? undefined,
    })),
  }))
  const sizeGroup = groups.find((g) => g.isSize)
  const sizes = (sizeGroup?.choices ?? []).map((c) => ({ label: c.label, price: c.price }))
  const prices = sizes.length ? sizes.map((s) => s.price) : [(r.price ?? 0) / 100]
  const temps: ('Hot' | 'Iced')[] = []
  if (sizes.some((s) => s.label.startsWith('Cold'))) temps.push('Iced')
  if (sizes.some((s) => s.label.startsWith('Hot'))) temps.push('Hot')
  const sizeLine = temps.length === 2 ? 'Cold or hot' : temps[0] === 'Hot' ? 'Hot only' : temps.length ? 'Cold only' : ''
  return {
    id: r.item_id,
    name: r.name,
    blurb: r.blurb || r.description || sizeLine,
    description: r.description,
    price: Math.min(...prices),
    priceMax: Math.max(...prices),
    badges: r.badges,
    badge: r.badges[0],
    isNew: r.is_new,
    section: r.category_id,
    kind: r.kind,
    temps: r.kind === 'drink' ? temps : undefined,
    sizes: [...sizes].sort((a, b) => a.price - b.price),
    available: r.is_available,
    unavailableReason: r.unavailable_reason ?? undefined,
    image: r.image_url ? photoUrls[r.image_url] : undefined,
    groups,
  }
}

/** Replaces the menu with fresh rows (start-up, and whenever staff change availability) */
export function setMenu(categories: CategoryRow[], items: ItemRow[]) {
  fill(
    sections,
    [...categories].sort(bySort).map((c) => ({
      id: c.category_id,
      title: c.title,
      tab: c.title,
      group: c.menu_group ?? '',
      badge: c.kind === 'collection' ? c.badge_match ?? undefined : undefined,
    })),
  )
  fill(boards, sections.filter((s) => !s.badge))
  fill(collections, sections.filter((s) => s.badge))
  fill(products, [...items].sort(bySort).map(toProduct))
}

export const productById = (id: string) => products.find((p) => p.id === id)

/** Items off the menu right now — reordering them triggers O-08 "Some items aren't available". */
export const isUnavailable = (id: string) => !productById(id)?.available
export const sectionById = (id: string) => sections.find((s) => s.id === id)
export const productsIn = (id: Section) => {
  const s = sectionById(id)
  return s?.badge ? products.filter((p) => p.badges.includes(s.badge!)) : products.filter((p) => p.section === id)
}

/** The item in the shape the pricing engine reads */
export const toPricingItem = (p: Product): Item => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  category: p.section,
  price: p.sizes.length ? null : p.price,
  available: p.available,
  active: true,
  groups: p.groups,
})

/* ----- Options (C-13 Product Detail) ----- */

export type Choice = { label: string; delta: number; badge?: string; isDefault?: boolean }
export type OptionGroup = {
  id: string
  title: string
  required: boolean
  pick: 'one' | 'many'
  choices: Choice[]
}

/** The option groups a product shows, in menu order. Size prices become deltas over the item's lowest price. */
export function optionGroupsFor(p: Product): OptionGroup[] {
  return p.groups
    .map((g) => ({
      id: g.code,
      title: g.title,
      required: g.required,
      pick: g.pick,
      choices: g.choices
        .filter((c) => c.available)
        .map((c) => ({
          label: c.label,
          delta: g.isSize ? c.price - p.price : c.price,
          badge: c.badge,
          isDefault: c.isDefault,
        })),
    }))
    .filter((g) => g.choices.length > 0)
}

/** Default pick in a one-choice group: the menu's default, else the cheapest (first on a tie). */
export function defaultChoice(g: OptionGroup) {
  const marked = g.choices.findIndex((c) => c.isDefault)
  if (marked >= 0) return marked
  const min = Math.min(...g.choices.map((c) => c.delta))
  return g.choices.findIndex((c) => c.delta === min)
}

/** The item as it comes by default: default choices picked, no add-ons. */
export function defaultOrder(productId: string) {
  const p = productById(productId)
  if (!p) return { productId, options: [] as string[], unitPrice: 0 }
  const options = defaultOptions(toPricingItem(p))
  return { productId, options, unitPrice: priceFor(productId, options) ?? p.price }
}

// SRS 2.4: Philippine peso, tax-inclusive, 2 decimal places
export const peso = pesoFormat

/** Today's price for an item with these options (reorders use current prices, SRS FR-ROR-03) */
export function priceFor(productId: string, options: string[]) {
  const p = productById(productId)
  if (!p) return undefined
  const extra = optionGroupsFor(p)
    .flatMap((g) => g.choices)
    .filter((c) => options.includes(c.label))
    .reduce((s, c) => s + c.delta, 0)
  return p.price + extra
}
