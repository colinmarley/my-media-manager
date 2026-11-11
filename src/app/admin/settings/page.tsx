import { redirect } from 'next/navigation';

/** Tape settings now live on the unified Settings page. */
export default function AdminSettingsRedirect() {
  redirect('/settings?tab=tape');
}
