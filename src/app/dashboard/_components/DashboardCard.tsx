import Link from 'next/link';
import { Button, Card, CardContent, Grid, Typography } from '@mui/material';
import { BUTTON_LABELS } from '@/constants/global';

type DashboardCardProps = {
  title: string;
  description: string;
  href: string;
};

function DashboardCard({
  title,
  description,
  href
}: DashboardCardProps) {
  return (
    <Grid size={{ xs: 12, sm: 6 }}>
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {description}
          </Typography>
          <Button component={Link} href={href} variant="contained">
            {BUTTON_LABELS.open}
          </Button>
        </CardContent>
      </Card>
    </Grid>
  );
}

export default DashboardCard;