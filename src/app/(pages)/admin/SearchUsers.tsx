// app/admin/SearchUsers.tsx
'use client'

import React, { FormEvent, JSX, useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type Props = {
  onStartLoading?: () => void;
};

/**
 * SearchUsers - accepts optional onStartLoading callback that will be
 * invoked just before navigation (useful to show a global spinner).
 */
export default function SearchUsers({ onStartLoading }: Props): JSX.Element {
  const router = useRouter()
  const pathnameRaw = usePathname()
  const searchParams = useSearchParams()

  const pathname = pathnameRaw ?? '/'

  const initialQuery = searchParams?.get('search') ?? ''
  const [value, setValue] = useState<string>(initialQuery)

  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const current = searchParams?.get('search') ?? ''
    setValue(current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams?.toString()])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    const currentParam = searchParams?.get('search') ?? ''
    if (value === currentParam) return

    debounceRef.current = setTimeout(() => {
      handleSubmit()
    }, 700)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape') {
        if (value !== '') {
          handleClear()
        } else {
          inputRef.current?.blur()
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function navigateWithQuery(query: string): void {
    const q = query.trim()
    const url = q ? `${pathname}?search=${encodeURIComponent(q)}` : pathname

    const current = `${pathname}${searchParams?.toString() ? `?${searchParams?.toString()}` : ''}`
    if (url === current) return

    // inform parent that a background process is starting (before navigation)
    onStartLoading?.()

    startTransition(() => {
      router.push(url)
    })
  }

  function handleSubmit(e?: FormEvent<HTMLFormElement> | undefined): void {
    if (e) e.preventDefault()

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    navigateWithQuery(value)
  }

  function handleClear(): void {
    setValue('')
    onStartLoading?.()
    startTransition(() => {
      router.push(pathname)
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 w-full"
      role="search"
      aria-label="Search users"
    >
      <label htmlFor="admin-search" className="sr-only">
        Search for users
      </label>

      <div className="relative flex-1">
        <input
          ref={inputRef}
          id="admin-search"
          name="search"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search users by name or email"
          className="w-full rounded-md border px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Search users by name or email"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="ml-1 inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        aria-label="Submit search"
      >
        {isPending ? (
          <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
            <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        ) : (
          'Search'
        )}
      </button>

      <span className="sr-only" aria-live="polite">
        {isPending ? 'Searching...' : ''}
      </span>
    </form>
  )
}
