"use client";

import { useEffect, useState } from 'react';
import styles from './Dashboard.module.css';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../firebaseConfig';

const Dashboard = () => {
    const [messages, setMessages] = useState<{ text: string; isFromUser: boolean }[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');

  useEffect(()=>{
    onAuthStateChanged(auth, (user) => {
        if (user) {
          // User is signed in, see docs for a list of available properties
          // https://firebase.google.com/docs/reference/js/firebase.User
          const uid = user.uid;
          // ...
          console.log("uid", uid);
          alert(`user is logged in ${uid}`);
        } else {
          // User is signed out
          // ...
          console.log("user is logged out");
          alert("user is logged out");
        }
      });

}, [])

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