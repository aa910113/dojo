import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { PersistShape } from './useSRS'

type SyncStatus = 'disabled' | 'signedOut' | 'syncing' | 'synced' | 'error'

const PUSH_DEBOUNCE_MS = 2000

function dailyActivity(d: any): number {
  if (!d) return -1
  return (d.correct ?? 0) + (d.wrong ?? 0) + (d.secondsStudied ?? 0)
}

// 合併本機與雲端,絕不丟資料:每張卡取練習次數較多的、每天取活動較多的
function mergePersist(local: PersistShape, remote: Partial<PersistShape>): PersistShape {
  const cards: PersistShape['cards'] = { ...(remote.cards ?? {}) }
  for (const [id, lc] of Object.entries(local.cards ?? {})) {
    const rc = cards[id]
    if (!rc || (lc.reps ?? 0) >= (rc.reps ?? 0)) cards[id] = lc
  }
  const daily: PersistShape['daily'] = { ...(remote.daily ?? {}) }
  for (const [date, ld] of Object.entries(local.daily ?? {})) {
    if (dailyActivity(ld) >= dailyActivity(daily[date])) daily[date] = ld
  }
  // settings:雲端已有卡片代表是已建立的帳號,以雲端為準;否則用本機
  const remoteEstablished = Object.keys(remote.cards ?? {}).length > 0
  const settings = (remoteEstablished && remote.settings ? remote.settings : local.settings)
  return { cards, daily, settings }
}

export const useCloudSync = () => {
  const { $supabase } = useNuxtApp()
  const supabase = $supabase as SupabaseClient | null
  const { importPersist } = useSRS()
  const persist = useState<PersistShape>('srs-persist')

  const user = useState<User | null>('cloud-user', () => null)
  const status = useState<SyncStatus>('cloud-status', () => 'disabled')
  const initialized = useState<boolean>('cloud-initialized', () => false)

  // 拉遠端期間暫停推送,避免 importPersist 觸發 watch 又立刻推回去
  let applyingRemote = false
  let pushTimer: ReturnType<typeof setTimeout> | null = null

  async function pull() {
    if (!supabase || !user.value) return
    status.value = 'syncing'
    const { data, error } = await supabase
      .from('user_state')
      .select('data')
      .eq('user_id', user.value.id)
      .maybeSingle()
    if (error) {
      console.warn('[sync] pull 失敗:', error.message)
      status.value = 'error'
      return
    }
    const remote = data?.data as Partial<PersistShape> | undefined
    const remoteHasData =
      remote &&
      typeof remote === 'object' &&
      (Object.keys(remote.cards ?? {}).length > 0 ||
        Object.keys(remote.daily ?? {}).length > 0)
    if (remoteHasData) {
      // 合併本機與雲端,寫回合併結果(雙向都不丟資料)
      const merged = mergePersist(persist.value, remote)
      applyingRemote = true
      importPersist(merged)
      applyingRemote = false
    }
    // 雲端空 → 用本機種子;雲端有 → 把合併結果寫回
    await push()
    status.value = 'synced'
  }

  async function push() {
    if (!supabase || !user.value) return
    status.value = 'syncing'
    const { error } = await supabase
      .from('user_state')
      .upsert({ user_id: user.value.id, data: persist.value }, { onConflict: 'user_id' })
    if (error) {
      console.warn('[sync] push 失敗:', error.message)
      status.value = 'error'
      return
    }
    status.value = 'synced'
  }

  function schedulePush() {
    if (!supabase || !user.value || applyingRemote) return
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => push(), PUSH_DEBOUNCE_MS)
  }

  async function signInWithGoogle() {
    if (!supabase) return
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signOut() {
    if (!supabase) return
    if (pushTimer) {
      clearTimeout(pushTimer)
      await push()
    }
    await supabase.auth.signOut()
    user.value = null
    status.value = 'signedOut'
  }

  function init() {
    if (!supabase) {
      status.value = 'disabled'
      return
    }
    if (initialized.value) return
    initialized.value = true
    status.value = 'signedOut'

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        user.value = data.session.user
        pull()
      }
    })

    supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      const was = user.value?.id
      user.value = nextUser
      if (nextUser && nextUser.id !== was) {
        pull()
      } else if (!nextUser) {
        status.value = 'signedOut'
      }
    })

    // 本機資料一變動就排程推送(debounced)
    watch(persist, () => schedulePush(), { deep: true })
  }

  return { user, status, signInWithGoogle, signOut, init, push, pull }
}
