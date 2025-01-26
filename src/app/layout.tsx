import React from 'react';
import Link from 'next/link';
import { MediaSelectorProvider } from '@/context/MediaSelectorContext';
import './globals.css'; // Import the global CSS file

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`dark-theme`}>
        <MediaSelectorProvider>
          <header className="header">
            <div className="header-left">
              <Link href="/dashboard">
                <button className="header-button">Dashboard</button>
              </Link>
            </div>
            <div className="header-center">
              <h1 className="header-title">My App</h1>
            </div>
            <div className="header-right">
              <Link href="/signup">
                <button className="header-button">Login/Sign Up</button>
              </Link>
            </div>
          </header>
          <main className="main-content">
            {children}
          </main>
        </MediaSelectorProvider>
      </body>
    </html>
  );
}