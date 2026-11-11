import React, { useState } from 'react';
import { Avatar, IconButton, ListItemIcon, Menu, MenuItem } from '@mui/material';
import { Logout } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import useAuthenticationStore from '../../store/useAuthenticationStore';
import { accent } from '@/theme/tokens';

const ProfileAccess = () => {
  const { logout } = useAuthenticationStore();
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleLogoutClick = async () => {
    await logout();
    setAnchorEl(null);
    router.push('/login');
  };

  return (
    <>
      <IconButton
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        size="small"
      >
        <Avatar sx={{ width: 28, height: 28, fontSize: '0.8125rem', bgcolor: accent.tint, color: accent.light }}>U</Avatar>
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={handleLogoutClick}>
          <ListItemIcon><Logout fontSize="small" /></ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
};

export default ProfileAccess;
