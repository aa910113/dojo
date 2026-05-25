import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { PersistShape } from './useSRS'

type SyncStatus = 'disabled' | 'signedOut' | 'syncing' | 'synced' | 'error'

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

  // 拉遠端期間暫停標記變動,避免 importPersist 觸發 watch
  let applyingRemote = false
  // 本機有未推送的變更時為 true,只在 checkpoint 推送(不再每 2 秒推)
  let dirty = false

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

  async function push(): Promise<boolean> {
    if (!supabase || !user.value) return false
    status.value = 'syncing'
    const { error } = await supabase
      .from('user_state')
      .upsert({ user_id: user.value.id, data: persist.value }, { onConflict: 'user_id' })
    if (error) {
      console.warn('[sync] push 失敗:', error.message)
      status.value = 'error'
      return false
    }
    status.value = 'synced'
    return true
  }

  // checkpoint 推送:只在有變更、已登入、有網路時推
  async function flush() {
    if (!supabase || !user.value || !dirty) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const ok = await push()
    if (ok) dirty = false
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
    await flush()
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

    // 變更只標記 dirty,不立即推送;推送由 checkpoint(flush)觸發
    watch(persist, () => {
      if (user.value && !applyingRemote) dirty = true
    }, { deep: true })

    if (typeof window !== 'undefined') {
      // App 切到背景 / 關閉分頁 → 把握最後機會同步
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush()
      })
      // 重新連上網路 → 補推離線期間的變更
      window.addEventListener('online', () => flush())
    }
  }

  return { user, status, signInWithGoogle, signOut, init, flush, push, pull }
}
