// Flow 2 — Home, menu and product (C-09 … C-13)
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ActiveOrderChip,
  BottomNav,
  CartBar,
  CategoryTile,
  Chip,
  GroupHeader,
  HeroControl,
  MenuBoard,
  ProductRow,
  ProductRowSkeleton,
  PromoBanner,
  Radio,
  ReorderCard,
  RewardsStrip,
  SearchButton,
  SectionHeader,
  Stepper,
  TextArea,
} from '../components/blocks'
import { Content, Row, Screen, TopBar, TopBarAction } from '../components/Screen'
import { Badge, ProductThumb } from '../components/blocks'
import { Icon } from '../components/Icon'
import { Button, Checkbox, Photo } from '../components/ui'
import { ClosedBanner, FulfillmentSummary, OfflineBanner } from '../components/order'
import interiorPhoto from '../assets/photos/interior-banquette.webp'
import lattesPhoto from '../assets/photos/iced-lattes-banquette.webp'
import cupsPhoto from '../assets/photos/ube-choco-matcha-cups.webp'
import wingsPhoto from '../assets/photos/wings-and-drinks.webp'
import {
  boards,
  collections,
  defaultChoice,
  defaultOrder,
  optionGroupsFor,
  peso,
  productById,
  products,
  productsIn,
  sectionById,
  sections,
  type Section,
} from '../data/menu'
import { useOverlay } from '../overlays/OverlayHost'
import { featuredPromotion, nextReward } from '../data/rewards'
import { useApp } from '../state/AppState'
import { retryConnection, useOnline } from '../state/online'
import { etaLine, stepLabel } from '../state/shared'
import './shop.css'

/** Shared handler for product rows: the whole row opens the product page, where options are chosen. */
function useProductActions() {
  const navigate = useNavigate()
  const open = (id: string) => navigate(`/product/${id}`)
  return { open }
}

/** Cart bar wired to app state. */
export function LiveCartBar({ withNav = true }: { withNav?: boolean }) {
  const navigate = useNavigate()
  const { cartCount, cartTotal } = useApp()
  return <CartBar count={cartCount} total={cartTotal} withNav={withNav} onClick={() => navigate('/cart')} />
}

/** The printed menu's three groups (Coffee, Non-Coffee, Food), each with its boards in board order.
 *  Worked out when used: the menu loads from the database after this file is imported. */
const menuGroups = () =>
  [...new Set(boards.map((b) => b.group))].map((group) => ({
    group,
    boards: boards.filter((b) => b.group === group),
  }))

/** Home's group tiles: a crop of the cafe's own photos showing what each group holds */
const groupPhotos: Record<string, { photo: string; position: string }> = {
  Coffee: { photo: lattesPhoto, position: '50% 70%' },
  'Non-Coffee': { photo: cupsPhoto, position: '40% 50%' },
  Food: { photo: wingsPhoto, position: '30% 75%' },
}

let homeHasLoaded = false
let promoShown = false

/** C-09 Home — states: Default, First launch, Guest, Loading (`?state=loading`). */
export function Home() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { session, name, firstLaunch, activeOrders, promoDismissed, setPromoDismissed, addToCart, points, open: shop } = useApp()
  const online = useOnline()
  const activeOrder = activeOrders[0]
  const { open } = useProductActions()
  const overlay = useOverlay()
  const forcedLoading = params.get('state') === 'loading'
  const [loading, setLoading] = useState(!homeHasLoaded || forcedLoading)

  useEffect(() => {
    if (forcedLoading) {
      setLoading(true)
      return
    }
    const t = setTimeout(() => {
      homeHasLoaded = true
      setLoading(false)
    }, 700)
    return () => clearTimeout(t)
  }, [forcedLoading])

  // O-01 Promo modal greets a newly signed-up member once.
  useEffect(() => {
    if (loading || !firstLaunch || session !== 'member' || promoShown || !featuredPromotion) return
    promoShown = true
    overlay.open('promo')
  }, [loading, firstLaunch, session, overlay])

  const reorder = ['caramel-macchiato', 'carbonara'].map(defaultOrder)
  const guest = session !== 'member'
  const firstName = name.trim().split(/\s+/)[0] || 'there'
  const showOrderStuff = !guest && !firstLaunch

  const board = (section: Section, limit: number) => (
    <>
      <Row>
        <SectionHeader title={sectionById(section)!.title} onLink={() => navigate(`/menu/section/${section}`)} />
      </Row>
      <Row>
        <MenuBoard>
          {loading
            ? Array.from({ length: limit }, (_, i) => <ProductRowSkeleton key={i} />)
            : productsIn(section)
                .slice(0, limit)
                .map((p) => (
                  <ProductRow key={p.id} product={p} onOpen={() => open(p.id)} hideBadge={sectionById(section)!.badge} />
                ))}
        </MenuBoard>
      </Row>
    </>
  )

  return (
    <Screen
      topBar={
        <TopBar
          type="home"
          title={guest ? "Welcome to MEGS'" : `Hi, ${firstName}`}
          actions={<TopBarAction label="Notifications" icon="bell" onClick={() => navigate('/notifications')} />}
        />
      }
      bottomNav={<BottomNav active="home" />}
      overlay={<LiveCartBar />}
    >
      <Content>
        {!online && (
          <Row>
            <OfflineBanner onRetry={retryConnection}>You're offline. The menu below is the one saved on this phone.</OfflineBanner>
          </Row>
        )}
        {!loading && showOrderStuff && activeOrder && (
          <Row>
            <ActiveOrderChip
              status={`${activeOrder.isDelayed ? 'Delayed' : stepLabel(activeOrder, activeOrder.status)} · Order #${activeOrder.number}`}
              eta={etaLine(activeOrder)}
              onClick={() => navigate(`/orders/tracking?n=${activeOrder.number}`)}
            />
          </Row>
        )}
        {!shop.open && (
          <Row>
            <ClosedBanner {...shop} />
          </Row>
        )}

        <Row>
          <SearchButton onClick={() => navigate('/search')} />
        </Row>

        <Row>
          <nav className="category-strip category-strip--3" aria-label="Menu">
            {menuGroups().map((g) => (
              <CategoryTile
                key={g.group}
                label={g.group}
                count={g.boards.reduce((n, b) => n + productsIn(b.id).length, 0)}
                onClick={() => navigate(`/menu?section=${g.boards[0].id}`)}
                {...groupPhotos[g.group]}
              />
            ))}
          </nav>
        </Row>

        <Row>
          {loading ? (
            <RewardsStrip state="loading" />
          ) : guest ? (
            <RewardsStrip state="guest" onClick={() => navigate('/welcome')} />
          ) : (
            <RewardsStrip
              points={`${points.toLocaleString('en-PH')} pts`}
              hint={nextReward(points).text}
              progress={nextReward(points).progress}
              onClick={() => navigate('/rewards')}
            />
          )}
        </Row>

        {board('best-sellers', 4)}

        {!loading && !promoDismissed && featuredPromotion && (
          <Row>
            <PromoBanner
              title={featuredPromotion.title}
              subtitle={featuredPromotion.validity}
              onClick={() => navigate(`/promotions/${featuredPromotion!.id}`)}
              onDismiss={() => setPromoDismissed(true)}
            />
          </Row>
        )}

        {!loading && showOrderStuff && (
          <>
            <Row>
              <SectionHeader title="Order again" />
            </Row>
            <Row>
              <ReorderCard
                summary={reorder.map((l) => productById(l.productId)!.name).join(', ')}
                total={reorder.reduce((s, l) => s + l.unitPrice, 0)}
                onReorder={() => {
                  reorder.forEach((l) => addToCart({ ...l, note: '', qty: 1 }))
                  navigate('/cart')
                }}
              />
            </Row>
          </>
        )}

        <Row>
          <figure className="store-card">
            <Photo
              src={interiorPhoto}
              alt="Inside MEGS' Cafe: grey concrete walls, black wall lamps on a pipe rail, a long orange banquette and wooden chairs"
              height={200}
              position="50% 38%"
            />
            <figcaption className="store-card__caption">
              <span className="t-h3">MEGS' Cafe</span>
              <span className="t-body-sm muted">
                Pick up at the counter, or have it delivered. The best time is coffee time.
              </span>
            </figcaption>
          </figure>
        </Row>

        {board('must-try', 3)}
      </Content>
    </Screen>
  )
}

/** The rail: Best Sellers first (what most people come for), then the printed menu's boards under
 *  their group. Oat Series appears on two boards, so the rail drops the suffix and the group says which. */
const railSections = () => [
  { group: '', items: collections.filter((c) => c.id === 'best-sellers') },
  ...[...new Set(boards.map((b) => b.group))].map((group) => ({
    group,
    items: boards.filter((b) => b.group === group),
  })),
]
const railLabel = (title: string) => title.replace(/ · (Coffee|Non-Coffee)$/, '')
// Remembered for the session, so coming back from a product returns to the same place in the list
let lastScroll = 0

/** C-10 Menu — a category rail on the left and one list on the right that scrolls through every
 *  section; the rail follows the list and jumps it to a section. */
export function Menu() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { open } = useProductActions()
  const { fulfillment, addresses, addressId, open: shop } = useApp()
  const online = useOnline()
  const address = addresses.find((a) => a.id === addressId)
  const all = railSections().flatMap((g) => g.items)
  const [active, setActive] = useState<Section>(all[0].id)
  const listRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const sectionRefs = useRef<Partial<Record<Section, HTMLElement | null>>>({})
  const jumping = useRef(false)

  // Highlight the section at the top of the list
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    // A link from Home (?section=) opens at that section once; after that the list keeps its place
    const linked = params.get('section')
    const target = linked ? sectionRefs.current[linked] : null
    list.scrollTop = target ? target.offsetTop : lastScroll
    if (linked) navigate('/menu', { replace: true })
    const onScroll = () => {
      lastScroll = list.scrollTop
      if (jumping.current) return
      let current = all[0].id
      for (const s of all) {
        const el = sectionRefs.current[s.id]
        if (el && el.offsetTop <= list.scrollTop + 8) current = s.id
      }
      setActive(current)
    }
    onScroll()
    list.addEventListener('scroll', onScroll, { passive: true })
    return () => list.removeEventListener('scroll', onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the active rail item in view
  useEffect(() => {
    railRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const jumpTo = (id: Section) => {
    const list = listRef.current
    const el = sectionRefs.current[id]
    if (!list || !el) return
    setActive(id)
    jumping.current = true
    // A direct jump: on a phone the tap should land at once, and a smooth scroll can be dropped mid-way
    list.scrollTop = el.offsetTop
    lastScroll = list.scrollTop
    setTimeout(() => (jumping.current = false), 50)
  }

  return (
    <Screen
      topBar={
        <TopBar
          type="title"
          title="Menu"
          actions={<TopBarAction label="Search the menu" icon="search" onClick={() => navigate('/search')} />}
        />
      }
      bottomNav={<BottomNav active="menu" />}
      overlay={<LiveCartBar />}
      bodyClassName="menu-split"
    >
      <div className="menu-split__where">
        {!online && <OfflineBanner onRetry={retryConnection}>You're offline. This is the menu saved on this phone.</OfflineBanner>}
        {!shop.open && <ClosedBanner {...shop} />}
        <FulfillmentSummary type={fulfillment} address={address} onChange={() => navigate('/fulfillment')} />
      </div>
      <div className="menu-split__cols">
        <nav className="menu-rail" ref={railRef} aria-label="Menu sections">
          {railSections().map((g) => (
            <div key={g.group || 'top'} className="menu-rail__group">
              {g.group && <span className="menu-rail__label">{g.group}</span>}
              {g.items.map((s) => (
                <button
                  key={s.id}
                  className={`menu-rail__item ${active === s.id ? 'is-active' : ''}`}
                  aria-current={active === s.id ? 'true' : undefined}
                  onClick={() => jumpTo(s.id)}
                >
                  {railLabel(s.title)}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="menu-list" ref={listRef}>
          {all.map((s) => (
            <section
              key={s.id}
              className="menu-list__section"
              ref={(el) => {
                sectionRefs.current[s.id] = el
              }}
              aria-labelledby={`sec-${s.id}`}
            >
              <h2 id={`sec-${s.id}`} className="t-h3 menu-list__title">
                {s.title}
              </h2>
              {productsIn(s.id).map((p) => (
                <ProductRow key={p.id} product={p} onOpen={() => open(p.id)} hideBadge={s.badge} />
              ))}
            </section>
          ))}
          {/* Leave room so the cart bar never covers the last item */}
          <div style={{ height: 96 }} />
        </div>
      </div>
    </Screen>
  )
}

/** C-11 Section list — the section's menu board with All / Hot / Iced chips. */
export function SectionList() {
  const { id = 'best-sellers' } = useParams()
  const section = sectionById(id) ?? sections[0]
  const { open } = useProductActions()
  const [filter, setFilter] = useState<'All' | 'Hot' | 'Iced'>('All')

  const all = productsIn(section.id)
  const hasTemps = all.some((p) => p.temps?.length)
  // Every food item on the menu is served hot, so food sits under Hot and never under Cold
  const items = all.filter((p) => filter === 'All' || (p.kind === 'food' ? filter === 'Hot' : p.temps?.includes(filter)))

  return (
    <Screen topBar={<TopBar title={section.title} />} overlay={<LiveCartBar withNav={false} />}>
      <Content>
        {hasTemps && (
          <Row>
            <div className="chip-row">
              {(['All', 'Hot', 'Iced'] as const).map((f) => (
                <Chip key={f} label={f === 'Iced' ? 'Cold' : f} selected={filter === f} onClick={() => setFilter(f)} />
              ))}
            </div>
          </Row>
        )}
        {items.length > 0 && (
          <Row>
            <MenuBoard>
              {items.map((p) => (
                <ProductRow key={p.id} product={p} onOpen={() => open(p.id)} />
              ))}
            </MenuBoard>
          </Row>
        )}
        {items.length === 0 && (
          <Row>
            <p className="t-body muted">Nothing {filter === 'Iced' ? 'cold' : filter.toLowerCase()} in this section right now.</p>
          </Row>
        )}
      </Content>
    </Screen>
  )
}

/** C-12 Search — idle shows recent searches + popular items; typing filters the menu. */
export function Search() {
  const navigate = useNavigate()
  const { open } = useProductActions()
  const { recentSearches, setRecentSearches } = useApp()
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  // SRS FR-MNU-06: results from 2 characters; before that, recent searches and popular items
  const searching = query.length >= 2
  const results = useMemo(
    () =>
      searching
        ? products.filter(
            (p) =>
              p.name.toLowerCase().includes(query) ||
              p.description.toLowerCase().includes(query) ||
              sectionById(p.section)?.title.toLowerCase().includes(query),
          )
        : [],
    [query, searching],
  )

  const remember = () => {
    if (!q.trim()) return
    setRecentSearches([q.trim(), ...recentSearches.filter((r) => r.toLowerCase() !== query)].slice(0, 6))
  }

  return (
    <Screen
      topBar={
        <div className="search-bar">
          <label className="search-field search-field--focused">
            <Icon name="search" size={20} color="var(--muted)" />
            <input
              autoFocus
              className="t-body"
              placeholder="Search the menu"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && remember()}
              aria-label="Search menu"
            />
          </label>
          <Button variant="text" height={48} full={false} onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      }
    >
      <Content>
        <h1 className="sr-only t-h1">Search the menu</h1>
        {!searching ? (
          <>
            {recentSearches.length > 0 && (
              <>
                <Row>
                  <div className="recent-header">
                    <span className="t-h3">Recent searches</span>
                    <Button variant="text" height={40} full={false} onClick={() => setRecentSearches([])}>
                      Clear
                    </Button>
                  </div>
                </Row>
                <Row>
                  <div className="chip-wrap">
                    {recentSearches.map((r) => (
                      <Chip key={r} label={r} onClick={() => setQ(r)} />
                    ))}
                  </div>
                </Row>
              </>
            )}
            <Row>
              <SectionHeader title="Popular items" />
            </Row>
            <Row>
              <MenuBoard>
                {productsIn('best-sellers')
                  .slice(0, 3)
                  .map((p) => (
                    <ProductRow key={p.id} product={p} onOpen={() => open(p.id)} />
                  ))}
              </MenuBoard>
            </Row>
          </>
        ) : results.length ? (
          <>
            <Row>
              <p className="t-body-sm muted">
                {results.length} result{results.length > 1 ? 's' : ''} for “{q.trim()}”
              </p>
            </Row>
            <Row>
              <MenuBoard>
                {results.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    onOpen={() => {
                      remember()
                      open(p.id)
                    }}
                   
                  />
                ))}
              </MenuBoard>
            </Row>
          </>
        ) : (
          <Row>
            <div className="empty-state">
              <span className="t-h3">No matches for “{q.trim()}”</span>
              <span className="t-body muted">Try another drink or dish name.</span>
            </div>
          </Row>
        )}
      </Content>
    </Screen>
  )
}

/** C-13 Product Detail — Default and Adding states. Opened from the cart with ?edit=<line key>, it edits that line. */
export function ProductDetail() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  // A fresh page per item (and per edited line), so one item's choices never carry over to the next
  return <ProductPage key={`${id}|${params.get('edit') ?? ''}`} id={id} />
}

function ProductPage({ id }: { id: string }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { addToCart, updateLine, cart, defaultSize } = useApp()
  const product = productById(id)
  const editing = cart.find((l) => l.key === params.get('edit') && l.productId === id)

  const groups = useMemo(() => (product ? optionGroupsFor(product) : []), [product])

  // One-choice groups hold the picked index; many-choice groups (add-ons) hold a tick per choice.
  // New items start on each group's default (the sheet's, else the cheapest); an edited line
  // starts from what was ordered.
  const [picked, setPicked] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(
      groups
        .filter((g) => g.pick === 'one')
        .map((g) => {
          // FR-CRT-05: the customer's saved drink size when this item comes in it, else the sheet's default
          const saved = g.id === 'size' ? g.choices.findIndex((c) => c.label === defaultSize) : -1
          if (!editing) return [g.id, saved >= 0 ? saved : defaultChoice(g)]
          const i = g.choices.findIndex((c) => editing.options.includes(c.label))
          return [g.id, i < 0 ? null : i]
        }),
    ),
  )
  const [extras, setExtras] = useState<Record<string, boolean[]>>(() =>
    Object.fromEntries(
      groups
        .filter((g) => g.pick === 'many')
        .map((g) => [g.id, g.choices.map((c) => !!editing?.options.includes(c.label))]),
    ),
  )
  const [note, setNote] = useState(editing?.note ?? '')
  const [qty, setQty] = useState(editing?.qty ?? 1)
  const [adding, setAdding] = useState(false)
  const [favorite, setFavorite] = useState(false)

  if (!product) {
    return (
      <Screen topBar={<TopBar title="Not found" />}>
        <Content>
          <Row>
            <p className="t-body muted">This item is no longer on the menu.</p>
          </Row>
        </Content>
      </Screen>
    )
  }

  const chosen = groups.flatMap((g) =>
    g.pick === 'one'
      ? picked[g.id] != null
        ? [g.choices[picked[g.id]!]]
        : []
      : g.choices.filter((_, i) => extras[g.id]?.[i]),
  )
  const unit = product.price + chosen.reduce((sum, c) => sum + c.delta, 0)

  // A one-choice group (Hot Chocolate comes in Hot · 12 oz only) is a fact, not a question
  const shown = groups.filter((g) => !(g.pick === 'one' && g.choices.length === 1))
  const fixed = groups.filter((g) => g.pick === 'one' && g.choices.length === 1).map((g) => g.choices[0].label)

  const add = () => {
    setAdding(true)
    setTimeout(() => {
      const known = new Set(groups.flatMap((g) => g.choices.map((c) => c.label)))
      const options = [
        ...chosen.map((c) => c.label),
        // options this screen has no control for are kept as ordered
        ...(editing?.options.filter((o) => !known.has(o)) ?? []),
      ]
      const line = { productId: product.id, options, note: note.trim(), unitPrice: unit, qty }
      if (editing) updateLine(editing.key, line)
      else addToCart(line)
      navigate(-1)
    }, 450)
  }

  return (
    <Screen
      footerBorder
      footer={
        <div className="pdp__footer">
          <Stepper value={qty} onChange={setQty} />
          <Button
            onClick={add}
            disabled={adding || !product.available}
            aria-busy={adding}
            className="pdp__add btn--split"
            height={52}
          >
            <span>{!product.available ? 'Sold out' : adding ? 'Added' : editing ? 'Update item' : 'Add to order'}</span>
            <span className="num">{peso(unit * qty)}</span>
          </Button>
        </div>
      }
    >
      <div className="content pdp__content">
        <Row>
          <div className="pdp__photo">
            <ProductThumb product={product} size="L" />
            <HeroControl label="Back" icon="back" onClick={() => navigate(-1)} style={{ left: 6, top: 6 }} />
            <HeroControl
              label={favorite ? 'Remove from favourites' : 'Add to favourites'}
              icon="heart"
              pressed={favorite}
              onClick={() => setFavorite((f) => !f)}
              style={{ right: 6, top: 6 }}
            />
          </div>
        </Row>
        <Row>
          <header className="pdp__intro">
            {(product.badges.length > 0 || product.isNew) && (
              <div className="pdp__badges">
                {product.badges.map((b) => (
                  <Badge key={b} size="md" tone="gold">
                    {b}
                  </Badge>
                ))}
                {product.isNew && (
                  <Badge size="md" tone="info">
                    New
                  </Badge>
                )}
              </div>
            )}
            <h1 className="t-h1 pdp__name">{product.name}</h1>
            {product.description && <p className="t-body muted">{product.description}</p>}
            {fixed.length > 0 && <p className="t-body-sm pdp__fixed">{fixed.join(' · ')}</p>}
          </header>
        </Row>

        {shown.map((g) => (
          <Row key={g.id}>
            <fieldset className="pdp__group">
              <legend className="sr-only">{g.title}</legend>
              <GroupHeader title={g.title} required={g.required} />
              {g.pick === 'one'
                ? g.choices.map((c, i) => (
                    <Radio
                      key={c.label}
                      name={g.id}
                      label={c.label}
                      checked={picked[g.id] === i}
                      onChange={() => setPicked((p) => ({ ...p, [g.id]: i }))}
                      // Sizes show the board's own price for that size; other choices show what they add
                      price={g.id === 'size' ? peso(product.price + c.delta) : undefined}
                      priceDelta={c.delta ? `+${peso(c.delta)}` : undefined}
                    />
                  ))
                : g.choices.map((c, i) => (
                    <Checkbox
                      key={c.label}
                      label={c.label}
                      checked={!!extras[g.id]?.[i]}
                      onChange={(v) =>
                        setExtras((e) => ({ ...e, [g.id]: e[g.id].map((x, j) => (j === i ? v : x)) }))
                      }
                      priceDelta={c.delta ? `+${peso(c.delta)}` : undefined}
                    />
                  ))}
            </fieldset>
          </Row>
        ))}

        <Row>
          <TextArea
            label="Special instructions"
            placeholder="Add a note (140 characters)"
            helper="Optional · up to 140 characters"
            value={note}
            onChange={setNote}
          />
        </Row>
      </div>
    </Screen>
  )
}

/** Placeholder used while a flow's screens are being built. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <Screen topBar={<TopBar title={title} />}>
      <Content>
        <Row>
          <p className="t-body muted">This screen is not built yet.</p>
        </Row>
      </Content>
    </Screen>
  )
}
