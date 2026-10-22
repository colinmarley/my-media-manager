'use client';

import React from 'react';
import { Box, Card, CardContent, Chip, Divider, Typography } from '@mui/material';
import { STATUS_COLORS, getRecentHistoryEntries } from '@/service/ingress/ingressQueueModel';

type Props = {
  history: Array<Record<string, any>>;
};

const IngressHistoryCard: React.FC<Props> = ({ history }) => (
  <Card>
    <CardContent>
      <Typography variant="h6" sx={{ mb: 2 }}>Recent History</Typography>
      {history.length === 0 ? (
        <Typography color="text.secondary">No processing history yet.</Typography>
      ) : (
        getRecentHistoryEntries(history).map(({ entry: item, index }) => (
          <Box key={`${item.item_id || index}-${index}`} sx={{ mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label={item.status}
                size="small"
                color={STATUS_COLORS[item.status as string] || 'default'}
              />
              {item.confidence_score != null && (
                <Typography variant="caption" color="text.secondary">
                  {item.confidence_score}%
                </Typography>
              )}
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ wordBreak: 'break-all' }}
            >
              {item.file_path || item.item_id}
            </Typography>
            {index < 9 && <Divider sx={{ mt: 1 }} />}
          </Box>
        ))
      )}
    </CardContent>
  </Card>
);

export default IngressHistoryCard;
