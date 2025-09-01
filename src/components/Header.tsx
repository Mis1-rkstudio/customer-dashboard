// src/components/Header.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { useEffect, useState } from 'react';

export default function Header() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const pathname = usePathname();
  const { cartItems } = useCart();

  const itemsCount = Array.isArray(cartItems) ? cartItems.length : 0;

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/orders', label: 'Orders' },
    { href: '/items', label: 'Items' },
  ];

  return (
    <header className="bg-gray-900 text-white shadow-sm">
      <nav className="container mx-auto px-6 py-4 flex items-center justify-between">
        <div className="text-2xl font-bold">
          <Link href="/">Order Management</Link>
        </div>

        <div className="flex items-center gap-6">
          <ul className="flex items-center gap-6">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`transition-colors hover:text-blue-400 ${pathname === link.href ? 'text-blue-500 font-semibold' : 'text-white'
                    }`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          {/* Auth area */}
          <SignedOut>
            <SignInButton fallbackRedirectUrl={'/'} />
            <SignUpButton>
              Sign Up
            </SignUpButton>
          </SignedOut>

          {/* Cart (only for authenticated users) */}
          <SignedIn>
            <Link
              href="/cart"
              className="relative inline-flex items-center p-1 rounded hover:text-blue-400 transition-colors"
              aria-label={`Cart — ${itemsCount} items`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>

              {mounted && itemsCount > 0 && (
                <span
                  className="absolute -top-2 -right-2 bg-red-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center"
                  aria-hidden="true"
                >
                  {itemsCount}
                </span>
              )}
            </Link>
            <UserButton />
          </SignedIn>
        </div>
      </nav>
    </header>
  );
}
