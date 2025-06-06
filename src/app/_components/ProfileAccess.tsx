import React, { useState } from 'react';
import { Avatar, Button, Menu, MenuItem, Typography } from '@mui/material';
import { deepOrange } from '@mui/material/colors';
import useAuth from '../../hooks/useAuth';
import useAuthenticationStore from '../../store/useAuthenticationStore';

const ProfileAccess = () => {
  const { handleLogout } = useAuth();
  const { user } = useAuthenticationStore();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogoutClick = async () => {
    await handleLogout();
    handleClose();
  };

  if (!user) {
    return null;
  }

  const displayName = user.displayName || user.email;

  return (
    <div>
      <Button onClick={handleClick}>
        <Avatar sx={Styles.avatar}>{displayName?.charAt(0)}</Avatar>
        <Typography variant="body1" sx={Styles.displayName}>
          {displayName}
        </Typography>
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