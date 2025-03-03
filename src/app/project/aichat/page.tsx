"use client";

import { useEffect, useState } from 'react';
import styles from './_styles/aichat.module.css';
import useAuthenticationStore from '@/store/useAuthenticationStore';

const Dashboard = () => {
    const [messages, setMessages] = useState<{ text: string; isFromUser: boolean }[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const { login, user } = useAuthenticationStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim()) {
      setMessages([...messages, {text: newMessage, isFromUser: true}]);
      setNewMessage('');
    }
  };

  return (
    <div className={styles.container}>
        <div className={styles.messagesContainer}>
            {messages.map((message, index) => (
                <div
                    key={index}
                    className={message.isFromUser ? styles.messageCardRight : styles.messageCardLeft}>
                {message.text}
                </div>
            ))}
        </div>
      <form onSubmit={handleSubmit} className={styles.form}>
        <textarea
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          className={styles.textarea}
          placeholder="Type your message..."
        />
        <button type="submit" className={styles.submitButton}>Send</button>
      </form>
    </div>
  );
};

export default Dashboard;