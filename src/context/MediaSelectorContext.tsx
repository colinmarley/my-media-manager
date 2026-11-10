"use client"
import React, { createContext, ReactNode } from 'react';
import useMediaSelector, { UseMediaSelectorReturn } from '../hooks/useMediaSelector';

const MediaSelectorContext = createContext<UseMediaSelectorReturn | undefined>(undefined);

export const MediaSelectorProvider = ({ children }: { children: ReactNode }) => {
  const mediaSelector = useMediaSelector();
  return (
    <MediaSelectorContext.Provider value={mediaSelector}>
      {children}
    </MediaSelectorContext.Provider>
  );
};