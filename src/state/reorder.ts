// Reorder a past order at today's prices (Orders → History, Order detail, Home's Order again).
// SRS FR-ROR: items no longer on the menu are listed first; if none is left the cart is unchanged.
import { useNavigate } from 'react-router-dom'
import { lineName } from '../components/order'
import { isUnavailable, priceFor } from '../data/menu'
import { useOverlay } from '../overlays/OverlayHost'
import { useApp, type CartLine } from './AppState'

export function useReorder() {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const { addToCart } = useApp()
  return async (lines: CartLine[]) => {
    const gone = (l: CartLine) => isUnavailable(l.productId) || priceFor(l.productId, l.options) === undefined
    const missing = lines.filter(gone)
    if (missing.length) {
      const ok = await overlay.confirm('unavailable', { items: missing.map(lineName) })
      // SRS FR-ROR-04: if every item is unavailable, the cart is left unchanged
      if (!ok || missing.length === lines.length) return
    }
    lines
      .filter((l) => !gone(l))
      .forEach((l) =>
        addToCart({ productId: l.productId, options: l.options, note: l.note, unitPrice: priceFor(l.productId, l.options)!, qty: l.qty }),
      )
    navigate('/cart')
  }
}
