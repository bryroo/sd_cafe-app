// Account screens for guests: a sign-in prompt in place of the screen (no redirect, so the address
// and Back keep working). See src/state/guest.ts.
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BottomNav, EmptyState, type IllustrationName, type Tab } from './blocks'
import { Content, Screen, TopBar } from './Screen'
import { Button } from './ui'
import { useApp } from '../state/AppState'
import { withNext } from '../state/guest'
import { useShared } from '../state/shared'

type Gate = {
  /** The screen's own title, so the guest knows where they are */
  title: string
  /** Why it needs an account: "Log in to see your orders." */
  reason: string
  illustration?: IllustrationName
  /** Tab roots keep their tab bar and big title */
  tab?: Tab
}

export function SignInScreen({ title, reason, illustration = 'receipt', tab }: Gate) {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const here = pathname + search
  return (
    <Screen
      topBar={<TopBar type={tab ? 'title' : 'back'} title={title} />}
      bottomNav={tab ? <BottomNav active={tab} /> : undefined}
    >
      <Content>
        <EmptyState
          illustration={illustration}
          title={reason}
          action={
            <>
              <Button onClick={() => navigate(withNext('/log-in', here))}>Log in</Button>
              <Button variant="secondary" onClick={() => navigate(withNext('/sign-up', here))}>
                Create account
              </Button>
              <Button variant="text" height={48} onClick={() => navigate('/menu')}>
                Browse the menu
              </Button>
            </>
          }
        >
          You can look around the menu as a guest. Ordering, rewards and your account need an account.
        </EmptyState>
      </Content>
    </Screen>
  )
}

/** Shows the screen to signed-in customers and a sign-in prompt to guests. Until the account check
 *  has finished the screen itself shows (with its loading skeletons), so a member opening the app on
 *  /orders never sees a flash of "Log in". */
export function MemberOnly({ children, ...gate }: Gate & { children: ReactNode }) {
  const { isMember } = useApp()
  const { ready } = useShared()
  return isMember || !ready ? <>{children}</> : <SignInScreen {...gate} />
}
