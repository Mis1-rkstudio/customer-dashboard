// src/components/Providers.tsx
'use client';

import React from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { CartProvider } from '@/context/CartContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
      <CartProvider>{children}</CartProvider>
    </ClerkProvider>
  );
}
