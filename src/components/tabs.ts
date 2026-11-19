// The customer app's five main tabs, shared by the phone BottomNav and the tablet/desktop AppNav.
import type { IconName } from './Icon'

export type Tab = 'home' | 'menu' | 'orders' | 'rewards' | 'profile'

export const tabs: { id: Tab; label: string; path: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', path: '/home', icon: 'home' },
  { id: 'menu', label: 'Menu', path: '/menu', icon: 'cup' },
  { id: 'orders', label: 'Orders', path: '/orders', icon: 'receipt' },
  { id: 'rewards', label: 'Rewards', path: '/rewards', icon: 'star' },
  { id: 'profile', label: 'Profile', path: '/profile', icon: 'user' },
]
