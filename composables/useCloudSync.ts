import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { PersistShape } from './useSRS'

type SyncStatus = 'disabled' | 'signedOut' | 'syncing' | 'synced' | 'error'

const PUSH_DEBOUNCE_MS = 2000

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
    if (data?.data && typeof data.data === 'object') {
      // 雲端有資料 → 載入(雲端為準)
      applyingRemote = true
      importPersist(data.data)
      applyingRemote = false
    } else {
      // 雲端還沒有 → 用本機資料初始化雲端
      await push()
    }
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
