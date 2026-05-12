import React, { useState } from 'react';
import { Avatar, Button, Menu, MenuItem } from '@mui/material';
import { deepOrange } from '@mui/material/colors';
import { useRouter } from 'next/navigation';
import useAuthenticationStore from '../../store/useAuthenticationStore';

const ProfileAccess = () => {
  const { logout } = useAuthenticationStore();
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogoutClick = async () => {
    await logout();
    handleClose();
    router.push('/login');
  };

  return (
    <div>
      <Button onClick={handleClick}>
        <Avatar sx={Styles.avatar}>U</Avatar>
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
      >
        <MenuItem onClick={handleLogoutClick}>Logout</MenuItem>
      </Menu>
    </div>
  );
};

const Styles = {
  avatar: {
    bgcolor: deepOrange[500],
  },
  displayName: {
    marginLeft: 1,
  }
}

export default ProfileAccess;