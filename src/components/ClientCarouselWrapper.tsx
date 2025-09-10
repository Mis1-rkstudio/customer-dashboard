// components/ClientCarouselWrapper.tsx
"use client";

import React, { JSX } from "react";
import DesignCardsCarousel, { CarouselItem } from "./carousels";

type Props = {
  items?: CarouselItem[] | undefined;
  autoplay?: boolean;
  autoplayInterval?: number;
  visibleCount?: number;
  className?: string;
};

export default function ClientCarouselWrapper({
  items,
  autoplay,
  autoplayInterval,
  visibleCount,
  className,
}: Props): JSX.Element {
  return (
    <DesignCardsCarousel
      items={items}
      autoplay={autoplay}
      autoplayInterval={autoplayInterval}
      visibleCount={visibleCount}
      className={className}
    />
  );
}
