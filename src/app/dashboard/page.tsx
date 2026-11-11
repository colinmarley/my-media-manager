"use client";

import React from 'react';
import useAttentionSummary from '@/hooks/attention/useAttentionSummary';
import HomeOverview from './_components/home/HomeOverview';
import TodoTiles from './_components/home/TodoTiles';

/** Home: the ingest pipeline at a glance, the To-Do counts, then library totals. */
const Dashboard = () => {
  // A server without the To-Do list gets no To-Do section at all.
  const { unsupported } = useAttentionSummary();
  return <HomeOverview todoSlot={unsupported ? undefined : <TodoTiles />} />;
};

export default Dashboard;
