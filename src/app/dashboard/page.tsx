"use client";

import { useEffect, useState } from 'react';
import { Box, TextField, Button, Typography, Paper } from '@mui/material';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../firebaseConfig';
import useAuthenticationStore from '@/store/useAuthenticationStore';

const Dashboard = () => {
  const [messages, setMessages] = useState<{ text: string; isFromUser: boolean }[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const { login, user } = useAuthenticationStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim()) {
      setMessages([...messages, { text: newMessage, isFromUser: true }]);
      setNewMessage('');
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '100vh',
        padding: '16px',
        backgroundColor: '#121212',
      }}
    >
      {/* Messages Container */}
      <Box
        sx={{
          flex: 1,
          width: '100%',
          overflowY: 'auto',
          marginBottom: '16px',
          padding: '16px',
          backgroundColor: '#1e1e1e',
          borderRadius: '8px',
        }}
      >
        {messages.map((message, index) => (
          <Paper
            key={index}
            elevation={3}
            sx={{
              padding: '8px 16px',
              marginBottom: '8px',
              alignSelf: message.isFromUser ? 'flex-end' : 'flex-start',
              backgroundColor: message.isFromUser ? '#3d5afe' : '#03a9f4',
              color: '#ffffff',
              borderRadius: '16px',
              maxWidth: '70%',
            }}
          >
            <Typography variant="body1">{message.text}</Typography>
          </Paper>
        ))}
      </Box>

      {/* Form for New Message */}
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          gap: '8px',
        }}
      >
        <TextField
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type your message..."
          fullWidth
          multiline
          rows={2}
          variant="outlined"
          sx={{
            backgroundColor: '#1e1e1e',
            borderRadius: '8px',
          }}
        />
        <Button
          type="submit"
          variant="contained"
          color="primary"
          sx={{
            height: '56px',
            borderRadius: '8px',
          }}
        >
          Send
        </Button>
      </Box>
    </Box>
  );
};

export default Dashboard;