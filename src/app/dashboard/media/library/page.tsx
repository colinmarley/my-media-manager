import { redirect } from 'next/navigation';

const LegacyLibraryRedirectPage = () => {
  redirect('/dashboard/my-library');
};

export default LegacyLibraryRedirectPage;