// What every visitor can read, guests included (FR-ACC-01): the menu, rewards, published offers,
// tiers and the store's settings. Loaded before the app renders; the last copy is kept on the device,
// so the app opens instantly and still shows the menu offline (NFR-REL-04, 3.2.2.5).
import { db } from '../lib/supabase'
import { setMenu, type CategoryRow, type ItemRow } from './menu'
import { setPromotions, setRewards, type PromotionRow, type RewardRow } from './rewards'

export type StoreRow = {
  settings_id: number
  cafe_name: string
  accepting_orders: boolean
  opening_hours: { open: string; close: string; closed: boolean }[]
  default_prep_minutes: number
  delivery_eta_minutes: number
  delivery_enabled: boolean
  delivery_fee: number
  points_per_peso: number
  new_order_chime: boolean
  auto_advance_demo: boolean
  demo_mode: boolean
}
export type TierRow = { tier_id: number; name: string; rank: number; discount_pct: number; qualify_orders: number | null; qualify_days: number | null; description: string | null; is_default: boolean }

export type Catalog = {
  categories: CategoryRow[]
  items: ItemRow[]
  rewards: RewardRow[]
  promotions: PromotionRow[]
  store: StoreRow
  tiers: TierRow[]
}

const CACHE = 'megs.cache.catalog'
let current: Catalog | null = null
const listeners = new Set<(c: Catalog) => void>()

export const getCatalog = () => current
export function onCatalog(l: (c: Catalog) => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function apply(c: Catalog) {
  current = c
  setMenu(c.categories, c.items)
  setRewards(c.rewards)
  setPromotions(c.promotions)
  listeners.forEach((l) => l(c))
}

const ITEM_COLUMNS =
  'item_id, category_id, kind, name, description, blurb, badges, image_url, price, is_new, is_available, unavailable_reason, sort_order, ' +
  'option_group(code, title, is_required, pick, is_size, sort_order, option_value(value_id, label, price, badge, is_default, is_available, sort_order))'

/** Reads the catalogue from the database; keeps the previous copy if that fails */
export async function refreshCatalog(): Promise<boolean> {
  const c = db()
  const [categories, items, rewards, promotions, store, tiers] = await Promise.all([
    c.from('menu_category').select('category_id, title, menu_group, kind, badge_match, sort_order'),
    c.from('menu_item').select(ITEM_COLUMNS).eq('is_active', true),
    c.from('reward').select('reward_id, name, cost_pts, terms, eligible_items, goal_label, sort_order'),
    c.from('promotion').select('promotion_id, title, description, terms, rule, starts_at, ends_at, is_one_time, target_category_id, is_featured'),
    c.from('store_settings').select('*').order('settings_id').limit(1).single(),
    c.from('tier').select('*').order('rank'),
  ])
  const failed = [categories, items, rewards, promotions, store, tiers].find((r) => r.error)
  if (failed) {
    console.warn('MEGS: could not load the menu', failed.error)
    return false
  }
  const next: Catalog = {
    categories: categories.data as CategoryRow[],
    items: items.data as unknown as ItemRow[],
    rewards: rewards.data as RewardRow[],
    promotions: promotions.data as PromotionRow[],
    store: store.data as StoreRow,
    tiers: tiers.data as TierRow[],
  }
  apply(next)
  try {
    localStorage.setItem(CACHE, JSON.stringify(next))
  } catch {
    /* storage full or blocked: the app still runs */
  }
  return true
}

/** Start-up: the saved copy at once if there is one, then the live one (waited for only on a first visit) */
export async function loadCatalog() {
  try {
    const saved = localStorage.getItem(CACHE)
    if (saved) {
      apply(JSON.parse(saved) as Catalog)
      void refreshCatalog()
      return
    }
  } catch {
    /* unreadable copy: load fresh */
  }
  await refreshCatalog()
}
