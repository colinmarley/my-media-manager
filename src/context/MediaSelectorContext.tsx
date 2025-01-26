"use client"
import React, { createContext, useContext, ReactNode } from 'react';
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

export const useMediaSelectorContext = (): UseMediaSelectorReturn => {
  const context = useContext(MediaSelectorContext);
  if (context === undefined) {
    throw new Error('useMediaSelectorContext must be used within a MediaSelectorProvider');
  }
  return context;
};