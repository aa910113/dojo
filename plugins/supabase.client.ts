import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const url = config.public.supabaseUrl
  const key = config.public.supabaseKey

  let client: SupabaseClient | null = null
  if (url && key) {
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  } else {
    console.warn('[supabase] 缺少 SUPABASE_URL / SUPABASE_KEY,雲端同步停用')
  }

  return {
    provide: {
      supabase: client,
    },
  }
})
