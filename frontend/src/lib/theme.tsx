import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemeMode = 'dark' | 'light'

/**
 * Dark is the product default; a chosen light theme is remembered. The same
 * key is read by the inline bootstrap in index.html so the first paint never
 * flashes dark before React mounts.
 */
const STORAGE_KEY = 'vibecheck.theme'

function storedTheme(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

type ThemeContextValue = {
  mode: ThemeMode
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  toggle: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(storedTheme)

  useEffect(() => {
    const root = document.documentElement
    // Swap with transitions paused so gradients (which can't transition) and
    // animated colours change in the same frame — no half-swapped state.
    root.classList.add('theme-switching')
    root.classList.toggle('theme-light', mode === 'light')
    // Lets native widgets (scrollbars, date pickers, autofill) follow the theme.
    root.style.colorScheme = mode
    void root.offsetWidth // flush the new colours while transitions are off
    const stop = () => root.classList.remove('theme-switching')
    const raf = requestAnimationFrame(stop)
    const timer = window.setTimeout(stop, 120)
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      /* private mode — theme still applies for this session */
    }
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      stop()
    }
  }, [mode])

  const toggle = useCallback(() => {
    setMode((m) => (m === 'dark' ? 'light' : 'dark'))
  }, [])

  const value = useMemo(() => ({ mode, toggle }), [mode, toggle])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
