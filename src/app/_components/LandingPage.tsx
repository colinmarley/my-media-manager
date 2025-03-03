"use client";

import React from 'react';
import { useRouter } from 'next/navigation';

import { Button, ButtonGroup, Typography } from '@mui/material';
import '../_styles/LandingPage.module.css';
import useAuthenticationStore from '@/store/useAuthenticationStore';

const LandingPage: React.FC = () => {
  const router = useRouter();
  const { user } = useAuthenticationStore();

  return (
    <div className="landing-page">
      <div className="content">
        <Typography variant="h1" className="header">My Media Manager</Typography>
        <Typography variant="h4" className="subheader">Organize your media with ease</Typography>
        <Typography variant="body1" className="description">My Media Manager is a simple and easy-to-use media manager that allows you to organize your media files in one place. Sign up now to get started!</Typography>
        {!user && <ButtonGroup variant="outlined" aria-label="Basic button group">
          <Button onClick={() => router.push('/signup')}>Sign Up</Button>
          <Button onClick={() => router.push('/login')}>Sign In</Button>
        </ButtonGroup>}
      </div>
    </div>
  );
};

export default LandingPage;