import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY
) as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)
export const isLocalDemoEnabled = !isSupabaseConfigured && import.meta.env.DEV
export const isMissingProductionSupabaseConfig =
  !isSupabaseConfigured && import.meta.env.PROD

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!)
  : null
