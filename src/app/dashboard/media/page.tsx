import { redirect } from 'next/navigation';

const LegacyMediaRedirectPage = () => {
  redirect('/dashboard/my-library');
};

export default LegacyMediaRedirectPage;