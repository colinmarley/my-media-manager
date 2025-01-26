"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import '../_styles/LandingPage.module.css';

const LandingPage: React.FC = () => {
  const router = useRouter();

  return (
    <div className="landing-page">
      <div className="content">
        <img src="/path/to/your/image.png" alt="Landing Page Image" className="landing-image" />
        <div className="buttons">
          <button className='landing-pg-btn' onClick={() => router.push('/signup')}>Sign Up</button>
          <button className='landing-pg-btn' onClick={() => router.push('/login')}>Sign In</button>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;